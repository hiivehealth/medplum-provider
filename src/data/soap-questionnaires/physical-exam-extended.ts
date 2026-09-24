import type { Questionnaire, QuestionnaireItem } from '@medplum/fhirtypes';

type Field = [string, string, string[]];
type Section = [string, string, Field[]];

const severity = ['no', 'mild', 'moderate', 'severe'];
const orientation = ['x 4', 'x 3', 'x 2', 'x 1'];
const consciousness = ['appropriate for age', 'slow', 'confused', 'arousable', 'stuporous', 'unresponsive', 'uncooperative'];
const buildItem = (prefix: string, [id, text, options]: Field): QuestionnaireItem => ({
  linkId: `${prefix}-${id}`,
  type: 'choice',
  text,
  answerOption: options.map((valueString) => ({ valueString })),
});
const buildSections = (prefix: string, sections: Section[]): QuestionnaireItem[] => sections.map(([id, text, fields]) => ({
  linkId: `${prefix}-${id}`,
  type: 'group',
  text,
  item: fields.map((field) => buildItem(prefix, field)),
}));

const adultExtended: Section[] = [
  ['general', 'General', [['alertness', 'Alertness', ['alert', 'obtunded', 'unresponsive', 'stuporous']], ['distress', 'Distress', ['no acute distress', 'mild distress', 'moderate distress', 'severe distress']]]],
  ['skin', 'Skin', [['temperature', 'Temperature', ['warm', 'cool', 'hot', 'cold']], ['moisture', 'Moisture', ['dry', 'moist', 'diaphoretic']]]],
  ['head-neck', 'Head and Neck', [['head-trauma', 'Head trauma', severity], ['trachea', 'Trachea', ['midline', 'deviated']], ['adenopathy', 'Adenopathy', severity], ['tenderness', 'Tenderness', severity]]],
  ['eyes', 'Eyes', [['conjunctiva', 'Conjunctiva', ['normal', 'erythematous', 'edematous', 'chemosis', 'pale']], ['sclera', 'Sclera', ['clear', 'injected', 'hematoma', 'jaundiced']]]],
  ['cardiovascular', 'Cardiovascular', [['rate-rhythm', 'Rate and rhythm', ['regular', 'irregular', 'irregularly-irregular']], ['peripheral-perfusion', 'Peripheral perfusion', ['normal', 'decreased']]]],
  ['respiratory', 'Respiratory', [['lungs', 'Lung sounds', ['CTA', 'basilar rales', 'rhonchi', 'expiratory wheezes']], ['respirations', 'Respirations', ['non-labored', 'labored', 'demonstrate accessory muscle use']]]],
  ['chest-wall', 'Chest Wall', [['deformity', 'Deformity', severity]]],
  ['gastrointestinal', 'Gastrointestinal', [['consistency', 'Consistency', ['soft', 'firm']], ['distention', 'Distention', ['non distended', 'distended']], ['tenderness', 'Tenderness', [...severity, 'RUQ', 'RLQ', 'LUQ', 'LLQ']], ['guarding', 'Guarding', [...severity, 'involuntary', 'RUQ', 'RLQ', 'LUQ', 'LLQ']]]],
  ['extremities', 'Extremities', [['deformity', 'Deformity', severity], ['trauma', 'Trauma', severity]]],
  ['neurologic', 'Neurologic', [['orientation', 'Orientation', orientation], ['level-of-consciousness', 'Level of consciousness', consciousness], ['cranial-nerves', 'CN II-XII', ['intact', 'deficit']], ['motor-strength', 'Motor strength', ['equal & normal bilaterally', 'decreased on right', 'decreased on left']], ['sensation', 'Sensation', ['equal & normal bilaterally', 'decreased on right', 'decreased on left']], ['speech', 'Speech', ['normal', 'aphasic', 'dysarthric', 'slurred']]]],
  ['psychiatric', 'Psychiatric', [['cooperation', 'Cooperation', ['cooperative', 'uncooperative']], ['affect', 'Affect', ['appropriate for age', 'anxious', 'depressed', 'tearful', 'hostile', 'non-communicative', 'flat', 'paranoid']], ['judgement', 'Judgement', ['normal', 'impaired']], ['thoughts', 'Psychiatric thoughts', ['normal', 'suicidal', 'homicidal', 'delusional', 'obsessive', 'tangential', 'with flight of ideas', 'hallucinogenic']]]],
];

const pediatricExtended: Section[] = [
  ['general', 'General', [['alertness', 'Alertness', ['alert', 'not alert']], ['distress', 'Distress', ['no acute distress', 'mild distress', 'moderate distress', 'severe distress']], ['behavior', 'Behavior', ['playful', 'withdrawn', 'fussy', 'consolable']], ['hydration', 'Hydration', ['normal', 'decreased', 'markedly decreased']], ['ill-appearing', 'Ill appearing', ['non', 'mildly', 'moderately', 'severely']]]],
  ['skin', 'Skin', [['temperature', 'Temperature', ['warm', 'cool', 'hot', 'cold']], ['moisture', 'Moisture', ['dry', 'moist', 'diaphoretic']]]],
  ['head-neck', 'Head and Neck', [['head-trauma', 'Head trauma', severity], ['trachea', 'Trachea', ['midline', 'deviated']], ['adenopathy', 'Adenopathy', severity], ['tenderness', 'Tenderness', severity]]],
  ['eyes', 'Eyes', [['conjunctiva', 'Conjunctiva', ['normal', 'erythematous', 'edematous', 'chemosis', 'pale']], ['sclera', 'Sclera', ['clear', 'injected', 'hematoma', 'jaundiced']]]],
  ...adultExtended.slice(4).map(([id, text, fields]) => [id, text, fields] as Section),
];

export const physicalExamAdultExtended: Questionnaire = {
  resourceType: 'Questionnaire',
  url: 'https://hiivehealth.com/questionnaire/physical-exam-adult-extended',
  version: '1.0.0',
  name: 'HiivePhysicalExamAdultExtended',
  title: 'Physical Exam - Adult Extended',
  status: 'active',
  description: 'Adult extended physical examination template transcribed from Physical Exam Templates.xlsx. Clinical labels and choices require owner approval.',
  item: buildSections('pe-adult-extended', adultExtended),
};

export const physicalExamPediatricExtended: Questionnaire = {
  resourceType: 'Questionnaire',
  url: 'https://hiivehealth.com/questionnaire/physical-exam-pediatric-extended',
  version: '1.0.0',
  name: 'HiivePhysicalExamPediatricExtended',
  title: 'Physical Exam - Pediatric Extended',
  status: 'active',
  description: 'Pediatric extended physical examination template transcribed from Physical Exam Templates.xlsx. Clinical labels and choices require owner approval.',
  item: buildSections('pe-pediatric-extended', pediatricExtended),
};