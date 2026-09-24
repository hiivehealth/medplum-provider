# Physical Examination Templates

## Purpose

Add a searchable Physical Examination template selector to the SOAP note. The
source is [Physical Exam Templates.xlsx](../../../../medplum-ubix/documents/Physical%20Exam%20Templates/Physical%20Exam%20Templates.xlsx), which defines these four templates:

| Workbook sheet | Proposed Questionnaire title | Proposed canonical URL |
| --- | --- | --- |
| `PE Adult - Brief` | `Physical Exam - Adult Brief` | `https://hiivehealth.com/questionnaire/physical-exam-adult-brief` |
| `PE Adult - Extended` | `Physical Exam - Adult Extended` | `https://hiivehealth.com/questionnaire/physical-exam-adult-extended` |
| `PE Peds - Brief` | `Physical Exam - Pediatric Brief` | `https://hiivehealth.com/questionnaire/physical-exam-pediatric-brief` |
| `PE Peds - Extended` | `Physical Exam - Pediatric Extended` | `https://hiivehealth.com/questionnaire/physical-exam-pediatric-extended` |

The workbook supplies structured findings and option sets across general appearance, skin, HEENT, cardiovascular, respiratory, abdomen, neurologic, and mental-status domains. It is the source for wording and allowed choices; clinical review must approve the FHIR translation before publication.

## Target Workflow

1. Add one `Physical Examination` card within the Objective portion of the note, after vitals and before Assessment.
2. Provide a searchable `Physical exam template` selector with the four workbook templates and `None`.
3. Render exactly one selected template with `QuestionnaireForm`; it persists one encounter-scoped `QuestionnaireResponse`.
4. Selecting another template or `None` warns that the existing physical-exam response will be removed. Confirming removes that response before the new selection is initialized.
5. Debounce response saves and disable selection and fields when the note is signed and locked, matching ROS behavior.
6. Do not preselect normal, negative, or other clinical findings. A clinician must record every finding intentionally.

## Questionnaire Translation

Create four versioned `Questionnaire` JSON resources from the workbook. Each resource will:

- Use stable, template-prefixed `linkId` values; link IDs do not depend on row position alone.
- Preserve the workbook's clinical field text and option ordering.
- Model bounded workbook lists as `choice` items with `answerOption` values.
- Model clinician narrative or qualifier fields as `text` or `string` items only where the workbook calls for free text.
- Group findings by clinical system when the workbook identifies a system, without adding a duplicate top-level `Physical Examination` heading because the card already supplies it.
- Contain no assumed answer, including an assumed normal finding, unless a clinician explicitly approves that behavior in writing.

Before generating the JSON, create a reviewed mapping table from every workbook field to: sheet, source row, Questionnaire `linkId`, FHIR item type, option values, and any clinical-review decision. Store the table with the generated resources so later spreadsheet revisions are traceable.

## Application Integration

Reuse the `SoapRosCard` interaction model as a new `SoapPhysicalExamCard` rather than overloading ROS:

- `PhysicalExamTemplateState` follows the existing `RosTemplateState` shape.
- Register the four canonical URLs in `SOAP_QUESTIONNAIRE_URLS` and the importer list in `GetStartedPage`.
- Load the latest encounter-scoped response per physical-exam URL through `useSoapQuestionnaires`.
- Prevent more than one active physical-exam template response for an encounter.
- Include the selected response in SOAP Composition and Provenance references when the note is signed.

## Extraction And Clinical Data

The first delivery persists the complete, auditable `QuestionnaireResponse` and includes it in the signed note. It must not automatically create diagnoses, orders, or treatment.

Creating extracted `Observation` resources is a separate, clinician-approved slice. Before it is implemented, clinical review must approve the observation boundaries, codes, value mappings, and whether absent answers mean undocumented or negative. Do not infer normal findings from blank or unselected fields.

## Clinical Review Questions

1. Are all four workbook templates approved for the intended clinician roles and encounter types?
2. Are the workbook field labels and every answer option clinically current and locally approved?
3. Should any finding be required, or should all findings remain optional to reflect a focused examination?
4. Is a normal/negative default ever permitted? The proposed default is no automatic clinical finding.
5. Which fields, if any, should become coded `Observation` resources after the initial QuestionnaireResponse-only delivery?
6. Should template availability be constrained by patient age, encounter type, role, or care setting?

## Work Slices

1. **Workbook mapping and clinical review - In progress.** The workbook drawings and option lists are mapped into all four forms. Resolve the review questions and record the approved workbook revision.
2. **Questionnaire resources - Complete.** Adult and Pediatric Brief/Extended version `1.0.0` Questionnaires are created. Add fixture tests for field counts, labels, option lists, and canonical URLs.
3. **Objective card - Complete.** The searchable Physical Examination selector, selected-template form, replacement confirmation, debounce save, and signed-lock behavior are implemented for all four templates.
4. **Persistence and sign-off.** Register the URLs, enforce a single active response, include the response in Composition/Provenance, and test template change/removal behavior.
5. **Publication and manual validation.** Upsert through the existing SOAP template importer; validate each template, response persistence, switching confirmation, signed-lock behavior, and the signed-note reference.
6. **Optional structured extraction.** Implement only after the clinical team approves the target Observations and mappings.

## Acceptance Criteria

1. A clinician can search and select any approved adult or pediatric template.
2. The displayed fields and choices match the approved workbook mapping table.
3. Selecting a new template does not silently discard an existing response.
4. One encounter has at most one active physical-exam response.
5. A signed and locked note cannot change the template or its answers.
6. Empty answers remain undocumented; they are never converted into normal findings.
7. The completed response is preserved and referenced by the signed SOAP note.