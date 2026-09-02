#!/usr/bin/env node
import http from 'node:http';
import { URL } from 'node:url';
import { authorizeNevadaRequest } from '../../medplum-ubix/scripts/nevada-consent-authorization.mjs';

const upstreamBaseUrl = process.env.MEDPLUM_UPSTREAM_URL || 'https://api.ehr.hiivehealth.net/';
const listenPort = Number(process.env.NEVADA_GATEWAY_PORT || 8787);
const fhirPrefix = '/fhir/R4/';

const CLINICAL_RESOURCE_TYPES = new Set([
  'AllergyIntolerance',
  'Condition',
  'DiagnosticReport',
  'DocumentReference',
  'Encounter',
  'Immunization',
  'MedicationRequest',
  'Observation',
  'Procedure',
  'ServiceRequest',
]);

function resourceTypeFromPath(pathname) {
  const relative = pathname.startsWith(fhirPrefix) ? pathname.slice(fhirPrefix.length) : '';
  return relative.split('/')[0] || undefined;
}

function patientReferenceFromRequest(requestUrl, body, resourceType) {
  const patient = requestUrl.searchParams.get('patient') || requestUrl.searchParams.get('subject');
  if (patient?.startsWith('Patient/')) {
    return patient;
  }
  if (resourceType === 'Patient') {
    const id = requestUrl.pathname.slice(`${fhirPrefix}Patient/`.length).split('/')[0];
    return id ? `Patient/${id}` : undefined;
  }
  if (body?.resourceType === 'Patient' && body.id) {
    return `Patient/${body.id}`;
  }
  if (body?.patient?.reference?.startsWith('Patient/')) {
    return body.patient.reference;
  }
  if (body?.subject?.reference?.startsWith('Patient/')) {
    return body.subject.reference;
  }
  return undefined;
}

function parseBearerToken(request) {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : undefined;
}

async function readJson(response) {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('json') ? response.json() : undefined;
}

async function getPatientContext(fetchImpl, patientReference, token) {
  if (!patientReference) {
    return { patient: undefined, consent: undefined };
  }
  const headers = { Accept: 'application/fhir+json', Authorization: `Bearer ${token}` };
  const patientResponse = await fetchImpl(new URL(`fhir/R4/${patientReference}`, upstreamBaseUrl), { headers });
  if (!patientResponse.ok) {
    return { patient: undefined, consent: undefined };
  }
  const patient = await readJson(patientResponse);
  const consentUrl = new URL('fhir/R4/Consent', upstreamBaseUrl);
  consentUrl.searchParams.set('patient', patientReference);
  consentUrl.searchParams.set('status', 'active');
  consentUrl.searchParams.set('_sort', '-_lastUpdated');
  consentUrl.searchParams.set('_count', '1');
  const consentResponse = await fetchImpl(consentUrl, { headers });
  const consentBundle = consentResponse.ok ? await readJson(consentResponse) : undefined;
  return { patient, consent: consentBundle?.entry?.[0]?.resource };
}

async function getPractitionerReference(fetchImpl, token) {
  const response = await fetchImpl(new URL('auth/me', upstreamBaseUrl), {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return undefined;
  }
  const profile = await readJson(response);
  return profile?.resourceType === 'Practitioner' && profile.id ? `Practitioner/${profile.id}` : undefined;
}

export async function getBreakGlassAudit(fetchImpl, patientReference, practitionerReference, token) {
  if (!patientReference || !practitionerReference) {
    return undefined;
  }
  const auditUrl = new URL('fhir/R4/AuditEvent', upstreamBaseUrl);
  auditUrl.searchParams.set('entity', patientReference);
  auditUrl.searchParams.set('subtype', 'emergency-access');
  auditUrl.searchParams.set('agent', practitionerReference);
  auditUrl.searchParams.set('_sort', '-recorded');
  auditUrl.searchParams.set('_count', '1');
  const response = await fetchImpl(auditUrl, {
    headers: { Accept: 'application/fhir+json', Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return undefined;
  }
  const bundle = await readJson(response);
  return bundle?.entry?.[0]?.resource;
}

function logDecision({ request, resourceType, patientReference, decision }) {
  console.log(JSON.stringify({
    type: 'nevada-consent-decision',
    timestamp: new Date().toISOString(),
    method: request.method,
    path: request.url,
    resourceType,
    patientReference,
    allowed: decision.allowed,
    code: decision.code,
    consentStatus: decision.consentStatus,
    expiresAt: decision.expiresAt,
  }));
}

export function createGatewayHandler({ fetchImpl = fetch, decision = authorizeNevadaRequest } = {}) {
  return async function gatewayHandler(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (!requestUrl.pathname.startsWith(fhirPrefix)) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: 'FHIR route required.' }] }));
      return;
    }
    const resourceType = resourceTypeFromPath(requestUrl.pathname);
    const token = parseBearerToken(request);
    const bodyText = request.method === 'GET' || request.method === 'HEAD' ? '' : await readRequestBody(request);
    let body;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid', diagnostics: 'Invalid JSON body.' }] }));
        return;
      }
    }

    if (!token) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'login', diagnostics: 'Bearer token required.' }] }));
      return;
    }

    const practitionerReference = await getPractitionerReference(fetchImpl, token);
    const patientReference = patientReferenceFromRequest(requestUrl, body, resourceType);
    const protectedRequest = CLINICAL_RESOURCE_TYPES.has(resourceType);
    const context = protectedRequest ? await getPatientContext(fetchImpl, patientReference, token) : {};
    const breakGlassAudit = protectedRequest
      ? await getBreakGlassAudit(fetchImpl, patientReference, practitionerReference, token)
      : undefined;
    const result = decision({
      practitionerReference,
      patient: context.patient ?? (patientReference ? { resourceType: 'Patient', id: patientReference.replace('Patient/', '') } : undefined),
      consent: context.consent,
      breakGlassAudit,
      resourceType,
      interaction: request.method === 'POST' ? 'create' : request.method === 'PUT' ? 'update' : 'read',
    });
    logDecision({ request, resourceType, patientReference, decision: result });

    if (!result.allowed) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden', diagnostics: result.reason }] }));
      return;
    }

    const upstreamUrl = new URL(request.url.replace(/^\//, ''), upstreamBaseUrl);
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.set('authorization', `Bearer ${token}`);
    const upstreamResponse = await fetchImpl(upstreamUrl, {
      method: request.method,
      headers,
      body: bodyText || undefined,
    });
    response.writeHead(upstreamResponse.status, Object.fromEntries(upstreamResponse.headers.entries()));
    response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const server = http.createServer((request, response) => {
    createGatewayHandler()(request, response).catch((error) => {
      console.error(JSON.stringify({ type: 'nevada-consent-gateway-error', timestamp: new Date().toISOString(), error: error.message }));
      if (!response.headersSent) response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: 'Authorization service unavailable.' }] }));
    });
  });
  server.listen(listenPort, () => console.log(`Nevada consent gateway listening on ${listenPort}`));
}
