# SOAP Subjective Complaint Model

## Purpose

The Subjective section must support more than one complaint. A clinician identifies exactly one as the chief complaint for the encounter. Each complaint has its own optional symptom onset date and time and optional severity so neither attribute is ambiguously shared across unrelated symptoms.

This design replaces the current flat, repeated `chief-complaint` answer plus one encounter-level `symptom-onset` answer. It does not turn a complaint into a confirmed diagnosis.

## Work Slices

1. **Questionnaire and extraction contract - Complete.** The published Subjective Questionnaire is version `1.4.0`; it uses repeating complaint groups, and extraction maps each complaint onset to its matching provisional Condition.
2. **Unsigned draft editor - Complete.** The custom Subjective editor supports add, per-row date/time entry, and row-level deletion. The active test project accepted the resulting `QuestionnaireResponse` payload.
3. **Signing and lock enforcement - Complete.** Signing rejects a SOAP note with zero non-empty complaints, including an immediate delete before its debounced save completes. Add, edit, and delete controls receive the existing signed-and-locked disabled state.
4. **Legacy presentation and migration - Complete.** Legacy repeated `chief-complaint` answers render without assigning their shared onset to any complaint. Historical responses are not rewritten until a clinician edits the Subjective section.

## Questionnaire Shape

Publish a new version of `https://hiivehealth.com/questionnaire/soap-subjective`. Replace the two current items with a repeating group:

```json
{
  "linkId": "complaint",
  "text": "Chief complaint",
  "type": "group",
  "repeats": true,
  "item": [
    {
      "linkId": "complaint-text",
      "text": "Complaint",
      "type": "string",
      "required": true
    },
    {
      "linkId": "complaint-onset",
      "text": "Symptom onset",
      "type": "dateTime",
      "required": false
    },
    {
      "linkId": "complaint-severity",
      "text": "Symptom severity",
      "type": "choice",
      "required": false
    },
    {
      "linkId": "complaint-is-chief",
      "text": "Chief complaint",
      "type": "boolean",
      "required": true
    }
  ]
}
```

Each repeat is a separate `QuestionnaireResponse.item` with `linkId: "complaint"`. The complaint text, onset, and severity appear as nested response items. Do not encode multiple complaints as a semicolon-delimited string or reuse one shared onset or severity field.

The Subjective section contains no separate patient-comment field. History of Present Illness is the single free-text narrative field.

## User Experience

1. Show one empty complaint row when a new Subjective response is opened.
2. Give every row a Complaint field, an optional Symptom onset date/time field, and optional Symptom severity choices.
3. Identify one complaint as the Chief complaint. The first row in a new response is selected by default; choosing another row moves the designation, and deleting the selected row moves it to the first remaining row.
4. Provide an `Add complaint` command below the rows. It creates one new empty repeating group.
5. Provide a delete icon for every complaint row. The icon removes that entire response group, including its onset, so a clinician can correct an entry made in error.
6. Allow an in-progress note to have zero complaint rows after deletion. Require at least one non-empty complaint and exactly one chief complaint before signing a SOAP note or marking the Subjective section complete.
7. Do not create a diagnosis, order, task, or care plan when a complaint is added or deleted.

For an already persisted but unsigned response, deletion updates the `QuestionnaireResponse` by removing the selected group and saving the new version. For a signed or locked note, disable add, edit, and delete; corrections must use the existing addendum workflow and record Provenance.

## Clinical Extraction

Update `extractSubjective()` to iterate the repeating `complaint` groups.

- For each non-empty `complaint-text`, preserve the current behavior of creating one provisional `Condition` associated with the patient and encounter.
- Map `complaint-onset` to that `Condition.onsetDateTime` when supplied.
- Keep HPI extraction unchanged.
- Never infer an onset for one complaint from another complaint's onset.

Clinical policy should continue to govern whether provisional complaint Conditions are shown on a problem list, but the extractor must keep the complaint-to-onset association intact.

## Versioning And Migration

Publish this as a new Questionnaire version, rather than mutating existing completed responses. Existing responses using `chief-complaint`, `symptom-onset`, or global `symptom-severity` remain valid historical records.

The UI does not assign an existing legacy onset or global severity to a particular complaint. The historical response remains unchanged until a clinician edits the section; new and edited responses use only the repeating `complaint` group.

Legacy responses also have no chief-complaint designation. Do not infer one from row order; require a clinician to select one before signing an edited SOAP note.

## Acceptance Checks

1. A clinician can enter two complaints with distinct onset date/times and severities; the saved response contains two complaint groups with their own values and exactly one `complaint-is-chief: true` answer.
2. Extraction creates two provisional Conditions and assigns each supplied onset to the matching Condition.
3. Deleting one unsigned complaint removes only that group's text and onset from the response and extraction output.
4. A note with no complaints, or without exactly one chief complaint, cannot be signed, but an unsigned draft can be cleared while it is being corrected.
5. A signed or locked note does not expose add, edit, or delete controls.
6. Legacy completed responses render without data loss and are never auto-rewritten.