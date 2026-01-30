import { Protocol, Supplement, Peptide, LifestyleTask, FastingPlan } from '@/types';

export const sampleSupplements: Supplement[] = [
  {
    id: 'sup_1',
    name: 'Omega-3 Fish Oil',
    brand: 'Nordic Naturals',
    dose: '2000mg EPA/DHA',
    frequency: 'daily',
    timing: 'with_meals',
    notes: 'Take with breakfast for best absorption',
    orderingLink: 'https://fullscript.com/...',
  },
  {
    id: 'sup_2',
    name: 'Vitamin D3 + K2',
    brand: 'Thorne',
    dose: '5000 IU D3 / 100mcg K2',
    frequency: 'daily',
    timing: 'morning',
    notes: 'Take with fat-containing meal',
  },
  {
    id: 'sup_3',
    name: 'Magnesium Glycinate',
    brand: 'Pure Encapsulations',
    dose: '400mg',
    frequency: 'daily',
    timing: 'before_bed',
    notes: 'Supports sleep and recovery',
  },
  {
    id: 'sup_4',
    name: 'NAC',
    brand: 'Jarrow',
    dose: '600mg',
    frequency: 'twice daily',
    timing: 'morning',
    notes: 'Supports glutathione production',
  },
  {
    id: 'sup_5',
    name: 'Berberine',
    brand: 'Thorne',
    dose: '500mg',
    frequency: 'twice daily',
    timing: 'with_meals',
    notes: 'Take before meals for blood sugar support',
  },
];

export const samplePeptides: Peptide[] = [
  {
    id: 'pep_1',
    name: 'BPC-157',
    dose: '250mcg',
    cycleLength: 30,
    daysOn: 30,
    daysOff: 30,
    timing: 'Morning subcutaneous',
    notes: 'Supports gut healing and tissue repair',
  },
  {
    id: 'pep_2',
    name: 'Sermorelin',
    dose: '300mcg',
    cycleLength: 90,
    daysOn: 5,
    daysOff: 2,
    timing: 'Before bed subcutaneous',
    notes: 'Growth hormone secretagogue',
  },
];

export const sampleLifestyleTasks: LifestyleTask[] = [
  {
    id: 'task_1',
    type: 'sauna',
    name: 'Infrared Sauna',
    target: 30,
    unit: 'minutes',
    frequency: '4x per week',
    timing: 'Evening',
    notes: 'Start at 140°F, work up to 160°F',
  },
  {
    id: 'task_2',
    type: 'cold_plunge',
    name: 'Cold Plunge',
    target: 3,
    unit: 'minutes',
    frequency: 'daily',
    timing: 'Morning',
    notes: 'Target 50-55°F water temperature',
  },
  {
    id: 'task_3',
    type: 'steps',
    name: 'Daily Steps',
    target: 10000,
    unit: 'steps',
    frequency: 'daily',
    notes: 'Aim for walking throughout the day',
  },
  {
    id: 'task_4',
    type: 'sunlight',
    name: 'Morning Sunlight',
    target: 10,
    unit: 'minutes',
    frequency: 'daily',
    timing: 'Within 30 min of waking',
    notes: 'No sunglasses, face the sun',
  },
  {
    id: 'task_5',
    type: 'meditation',
    name: 'Breathwork/Meditation',
    target: 15,
    unit: 'minutes',
    frequency: 'daily',
    timing: 'Morning or evening',
  },
];

export const sampleFastingPlan: FastingPlan = {
  id: 'fast_1',
  type: 'intermittent',
  eatingWindow: { start: '12:00', end: '20:00' },
  extended24hDays: ['Sunday'],
  notes: '16:8 protocol with weekly 24h fast',
};

export const sampleProtocol: Protocol = {
  id: 'proto_1',
  name: 'Foundation Protocol',
  description: 'Comprehensive longevity optimization protocol focusing on metabolic health, recovery, and cellular regeneration.',
  startDate: '2025-01-15',
  endDate: '2025-04-15',
  status: 'active',
  version: 1,
  supplements: sampleSupplements,
  peptides: samplePeptides,
  fastingPlan: sampleFastingPlan,
  lifestyleTasks: sampleLifestyleTasks,
  createdAt: '2025-01-10',
  updatedAt: '2025-01-20',
};

export const protocolTemplates = [
  {
    id: 'template_1',
    name: 'Gut Healing Protocol',
    description: 'Focused on repairing gut lining and restoring microbiome balance',
    duration: '12 weeks',
  },
  {
    id: 'template_2',
    name: 'Metabolic Optimization',
    description: 'Improve insulin sensitivity and metabolic markers',
    duration: '8 weeks',
  },
  {
    id: 'template_3',
    name: 'Longevity Basics',
    description: 'Foundation supplements and lifestyle habits for healthspan',
    duration: 'Ongoing',
  },
  {
    id: 'template_4',
    name: 'Athletic Recovery',
    description: 'Enhanced recovery and performance optimization',
    duration: '6 weeks',
  },
];
