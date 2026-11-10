import type { Questionnaire } from '@medplum/fhirtypes';
import core from './red-rover-authoring-templates.json';
import adultBrief from './soap-questionnaires/physical-exam-adult-brief.json';
import { physicalExamAdultExtended, physicalExamPediatricExtended } from './soap-questionnaires/physical-exam-extended';
import pediatricBrief from './soap-questionnaires/physical-exam-pediatric-brief.json';
import rosBrief from './soap-questionnaires/ros-brief-normal.json';
import rosExtended from './soap-questionnaires/ros-extended-normal.json';
import rosUnable from './soap-questionnaires/ros-unable-to-obtain.json';

export const RED_ROVER_AUTHORING_TEMPLATES = [
  ...core,
  rosBrief,
  rosExtended,
  rosUnable,
  adultBrief,
  physicalExamAdultExtended,
  pediatricBrief,
  physicalExamPediatricExtended,
] as Questionnaire[];

export const RED_ROVER_AUTHORING_SECTIONS = [
  'Subjective',
  'Objective',
  'Assessment',
  'Plan',
  'ADTMC A-01',
  'ROS - Brief Normal',
  'ROS - Extended Normal',
  'ROS - Unable to Obtain',
  'Physical Exam - Adult Brief',
  'Physical Exam - Adult Extended',
  'Physical Exam - Pediatric Brief',
  'Physical Exam - Pediatric Extended',
];
