import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEditableParentTrainingSummary, filterMasteredGoalsForPeriod, isLegacyGeneratedParentTrainingSummary, parentTrainingGoalIdentity, parentTrainingGoalKey, parentTrainingGoalLabel, summarizeParentTrainingReport } from '../public/parent-training-report.js';
import { removeParentGoalPointFromSession } from '../public/session-utils.js';

test('parent-training summary deduplicates goals and caregivers across sessions', () => {
  const model = summarizeParentTrainingReport({
    parentSessions: [
      {
        date: '2026-06-01',
        parentTraining: { caregiverName: 'Ariana', trainingFocus: 'daily living routines' },
        parentGoals: [
          { goalName: 'Caregiver will run first-then routine independently', targetName: 'Use first-then board before verbal prompting', fidelity: 80 },
          { goalName: 'Caregiver will run first-then routine independently', targetName: 'Use first-then board before verbal prompting', fidelity: 80 }
        ]
      },
      {
        date: '2026-06-08',
        parentTraining: { caregiverName: 'Ariana', trainingFocus: 'daily living routines' },
        parentGoals: [
          { goalName: 'Caregiver will prompt toilet routine consistently', targetName: 'Deliver visual prompt before transition', fidelity: 90 }
        ]
      }
    ],
    currentGoals: [
      { goalName: 'Caregiver will run first-then routine independently', targetName: 'Use first-then board before verbal prompting' },
      { goalName: 'Caregiver will prompt toilet routine consistently', targetName: 'Deliver visual prompt before transition' },
      { goalName: 'Caregiver will run first-then routine independently', targetName: 'Use first-then board before verbal prompting' }
    ],
    goalReviewsByKey: {
      [parentTrainingGoalKey({ goalName: 'Caregiver will run first-then routine independently', targetName: 'Use first-then board before verbal prompting' })]: 'active',
      [parentTrainingGoalKey({ goalName: 'Caregiver will prompt toilet routine consistently', targetName: 'Deliver visual prompt before transition' })]: 'mastered'
    },
    masteredGoalsDuringPeriod: [
      { goalName: 'Caregiver will prompt toilet routine consistently', targetName: 'Deliver visual prompt before transition' }
    ]
  });

  assert.equal(model.sessionCount, 2);
  assert.equal(model.averageFidelity, 83);
  assert.deepEqual(model.caregivers, ['Ariana']);
  assert.deepEqual(model.focusAreas, ['daily living routines']);
  assert.deepEqual(model.activeGoals.map(parentTrainingGoalLabel), [
    'Caregiver will run first-then routine independently - Use first-then board before verbal prompting'
  ]);
  assert.deepEqual(model.masteredGoals.map(parentTrainingGoalLabel), [
    'Caregiver will prompt toilet routine consistently - Deliver visual prompt before transition'
  ]);
  assert.deepEqual(model.masteredGoalsDuringPeriod.map(parentTrainingGoalLabel), [
    'Caregiver will prompt toilet routine consistently - Deliver visual prompt before transition'
  ]);
  assert.match(model.summaryText, /2 parent-training sessions were completed/i);
  assert.match(model.recommendationText, /generalization|coaching|maintenance/i);
});

test('parent-training summary provides clean empty state when no sessions exist', () => {
  const model = summarizeParentTrainingReport({
    parentSessions: [],
    currentGoals: [
      { goalName: 'Caregiver will run first-then routine independently', targetName: 'Use first-then board before verbal prompting' }
    ],
    goalReviewsByKey: {
      [parentTrainingGoalKey({ goalName: 'Caregiver will run first-then routine independently', targetName: 'Use first-then board before verbal prompting' })]: 'active'
    },
    masteredGoalsDuringPeriod: []
  });

  assert.equal(model.sessionCount, 0);
  assert.equal(model.averageFidelity, 0);
  assert.deepEqual(model.caregivers, []);
  assert.equal(model.activeGoals.length, 1);
  assert.equal(model.masteredGoals.length, 0);
  assert.equal(model.summaryText, 'No parent-training sessions were documented during this reporting period.');
  assert.match(model.recommendationText, /Resume caregiver-training sessions/i);
});

test('parent-training goal label stays readable when one side is missing', () => {
  assert.equal(parentTrainingGoalLabel({ goalName: 'Coach caregiver on transitions', targetName: '' }), 'Coach caregiver on transitions');
  assert.equal(parentTrainingGoalLabel({ goalName: '', targetName: 'Use visual timer before transitions' }), 'Use visual timer before transitions');
});

test('editable parent-training summary includes mastered goals from the authorization period once each', () => {
  const text = buildEditableParentTrainingSummary({
    summaryText: '2 parent-training sessions were completed during this reporting period. 1 active parent-training goal remains in progress.',
    masteredGoalsDuringPeriod: [
      {
        parentTrainingGoalId: 'goal-1',
        goalName: 'Caregiver will prompt toilet routine consistently',
        targetName: 'Deliver visual prompt before transition'
      },
      {
        parentTrainingGoalId: 'goal-1',
        goalName: 'Caregiver will prompt toilet routine consistently',
        targetName: 'Deliver visual prompt before transition'
      }
    ]
  });

  assert.match(text, /Mastered Parent Training Goals During Authorization Period:/);
  assert.match(text, /- Caregiver will prompt toilet routine consistently - Deliver visual prompt before transition/);
  assert.equal((text.match(/- Caregiver will prompt toilet routine consistently - Deliver visual prompt before transition/g) || []).length, 1);
  assert.doesNotMatch(text, /Ariana|80%|6\/1\/2026/);
});

test('parent-training summary includes a domain breakdown with goal and target counts', () => {
  const model = summarizeParentTrainingReport({
    parentSessions: [
      {
        date: '2026-06-01',
        parentTraining: { caregiverName: 'Ariana', trainingFocus: 'daily living routines' },
        parentGoals: [
          { goalName: 'Caregiver will run first-then routine independently', targetName: 'Use first-then board before verbal prompting', fidelity: 80 }
        ]
      },
      {
        date: '2026-06-08',
        parentTraining: { caregiverName: 'Ariana', trainingFocus: 'daily living routines' },
        parentGoals: [
          { goalName: 'Caregiver will prompt toilet routine consistently', targetName: 'Deliver visual prompt before transition', fidelity: 90 }
        ]
      },
      {
        date: '2026-06-10',
        parentTraining: { caregiverName: 'Ariana', trainingFocus: 'community safety practice' },
        parentGoals: [
          { goalName: 'Caregiver will support safe store transitions', targetName: 'Use visual checklist before entering store', fidelity: 100 }
        ]
      }
    ],
    currentGoals: [
      { goalName: 'Caregiver will run first-then routine independently', targetName: 'Use first-then board before verbal prompting', domain: 'daily living routines' },
      { goalName: 'Caregiver will prompt toilet routine consistently', targetName: 'Deliver visual prompt before transition', domain: 'daily living routines' },
      { goalName: 'Caregiver will support safe store transitions', targetName: 'Use visual checklist before entering store', domain: 'community safety practice' }
    ],
    goalReviewsByKey: {
      [parentTrainingGoalKey({ goalName: 'Caregiver will run first-then routine independently', targetName: 'Use first-then board before verbal prompting' })]: 'active',
      [parentTrainingGoalKey({ goalName: 'Caregiver will prompt toilet routine consistently', targetName: 'Deliver visual prompt before transition' })]: 'mastered',
      [parentTrainingGoalKey({ goalName: 'Caregiver will support safe store transitions', targetName: 'Use visual checklist before entering store' })]: 'mastered'
    },
    masteredGoalsDuringPeriod: [
      { parentTrainingGoalId: 'goal-1', goalName: 'Caregiver will prompt toilet routine consistently', targetName: 'Deliver visual prompt before transition', domain: 'daily living routines', masteredDate: '2026-06-08' },
      { parentTrainingGoalId: 'goal-2', goalName: 'Caregiver will support safe store transitions', targetName: 'Use visual checklist before entering store', domain: 'community safety practice', masteredDate: '2026-06-10' }
    ]
  });

  assert.deepEqual(model.domainBreakdown, [
    {
      domain: 'community safety practice',
      activeGoals: 0,
      masteredGoals: 1,
      onHoldGoals: 0,
      percentGoalsMastered: '100%',
      activeTargets: 0,
      masteredTargets: 1,
      onHoldTargets: 0,
      percentTargetsMastered: '100%'
    },
    {
      domain: 'daily living routines',
      activeGoals: 1,
      masteredGoals: 1,
      onHoldGoals: 0,
      percentGoalsMastered: '50%',
      activeTargets: 1,
      masteredTargets: 1,
      onHoldTargets: 0,
      percentTargetsMastered: '50%'
    }
  ]);
  assert.deepEqual(model.totals, {
    masteredGoals: 2,
    activeGoals: 1,
    onHoldGoals: 0,
    masteredTargets: 2,
    activeTargets: 1,
    onHoldTargets: 0,
    totalTargets: 3
  });
});

test('editable parent-training summary renders status summary and domain breakdown table', () => {
  const text = buildEditableParentTrainingSummary({
    summaryText: '2 parent-training sessions were completed during this reporting period. 1 active parent-training goal remains in progress.',
    totals: {
      masteredGoals: 1,
      activeGoals: 1,
      onHoldGoals: 0,
      masteredTargets: 1,
      activeTargets: 1,
      onHoldTargets: 0,
      totalTargets: 2
    },
    masteredGoalsDuringPeriod: [
      {
        parentTrainingGoalId: 'goal-1',
        goalName: 'Caregiver will prompt toilet routine consistently',
        targetName: 'Deliver visual prompt before transition',
        domain: 'daily living routines'
      }
    ],
    masteredTargetsDuringPeriod: [
      {
        parentTrainingGoalId: 'goal-1',
        goalName: 'Caregiver will prompt toilet routine consistently',
        targetName: 'Deliver visual prompt before transition',
        domain: 'daily living routines'
      }
    ],
    activeGoals: [
      {
        goalName: 'Caregiver will run first-then routine independently',
        targetName: 'Use first-then board before verbal prompting',
        domain: 'daily living routines'
      }
    ],
    activeTargets: [
      {
        goalName: 'Caregiver will run first-then routine independently',
        targetName: 'Use first-then board before verbal prompting',
        domain: 'daily living routines'
      }
    ],
    domainBreakdown: [
      {
        domain: 'daily living routines',
        activeGoals: 1,
        masteredGoals: 1,
        onHoldGoals: 0,
        percentGoalsMastered: '50%',
        activeTargets: 1,
        masteredTargets: 1,
        onHoldTargets: 0,
        percentTargetsMastered: '50%'
      }
    ]
  });

  assert.match(text, /Status Summary:/);
  assert.match(text, /- Goals mastered during authorization period: 1/);
  assert.match(text, /- Mastered caregiver-training targets: 1/);
  assert.match(text, /- Active caregiver-training goals: 1/);
  assert.match(text, /Domain Breakdown:/);
  assert.match(text, /\| daily living routines \| 1 \| 1 \| 0 \| 50% \| 1 \| 1 \| 0 \| 50% \|/);
  assert.match(text, /Mastered Parent Training Goals During Authorization Period:/);
});

test('legacy generated parent-training summaries are detected for backward-compatible refresh', () => {
  assert.equal(isLegacyGeneratedParentTrainingSummary(`2 parent-training sessions were completed during this reporting period. 1 active parent-training goal remains in progress.

Mastered Parent Training Goals During Authorization Period:
- Caregiver will prompt toilet routine consistently - Deliver visual prompt before transition`), true);
  assert.equal(isLegacyGeneratedParentTrainingSummary(`2 parent-training sessions were completed during this reporting period.

Status Summary:
- Goals mastered during authorization period: 1

Domain Breakdown:
| Domain | Active Goals |
| --- | ---: |
| daily living routines | 1 |`), false);
});

test('editable parent-training summary shows empty-state sentence when no goals were mastered in range', () => {
  const text = buildEditableParentTrainingSummary({
    summaryText: '1 parent-training session was completed during this reporting period. 1 active parent-training goal remains in progress.',
    masteredGoalsDuringPeriod: []
  });

  assert.match(text, /No parent-training goals were mastered during this authorization period\./);
});

test('parent-training identity prefers stable ids before normalized text', () => {
  assert.equal(parentTrainingGoalIdentity({ parentTrainingGoalId: 'pt-1', targetId: 'target-1', goalName: 'A', targetName: 'B' }), 'pt-1');
  assert.equal(parentTrainingGoalIdentity({ targetId: 'target-1', goalName: 'A', targetName: 'B' }), 'target-1');
  assert.equal(parentTrainingGoalIdentity({ goalName: 'A', targetName: 'B' }), 'a::b');
});

test('mastered parent-training goals are filtered to the authorization/reporting period and deduped once each', () => {
  const goals = filterMasteredGoalsForPeriod([
    { parentTrainingGoalId: 'goal-1', goalName: 'Goal A', targetName: 'Target A', masteredDate: '2026-06-02' },
    { parentTrainingGoalId: 'goal-1', goalName: 'Goal A', targetName: 'Target A', masteredDate: '2026-06-02' },
    { parentTrainingGoalId: 'goal-2', goalName: 'Goal B', targetName: 'Target B', masteredDate: '2026-05-20' },
    { parentTrainingGoalId: 'goal-3', goalName: 'Goal C', targetName: 'Target C', masteredDate: '2026-06-20' }
  ], '2026-06-01', '2026-06-15');

  assert.deepEqual(goals.map((goal) => goal.parentTrainingGoalId), ['goal-1']);
});

test('deleted caregiver-training points are excluded from fidelity averages and report summaries', () => {
  const originalSessions = [
    {
      date: '2026-06-01',
      parentTraining: { caregiverName: 'Ariana', trainingFocus: 'transitions' },
      parentGoals: [
        { goalName: 'Coach caregiver on transitions', targetName: 'Use visual timer', fidelity: 100 }
      ]
    },
    {
      date: '2026-06-08',
      parentTraining: { caregiverName: 'Ariana', trainingFocus: 'transitions' },
      parentGoals: [
        { goalName: 'Coach caregiver on transitions', targetName: 'Use visual timer', fidelity: 60 }
      ]
    }
  ];

  const updatedSessions = [
    removeParentGoalPointFromSession(originalSessions[0], 'Coach caregiver on transitions', 'Use visual timer').session,
    originalSessions[1]
  ];

  const model = summarizeParentTrainingReport({
    parentSessions: updatedSessions,
    currentGoals: [
      { goalName: 'Coach caregiver on transitions', targetName: 'Use visual timer' }
    ],
    goalReviewsByKey: {
      [parentTrainingGoalKey({ goalName: 'Coach caregiver on transitions', targetName: 'Use visual timer' })]: 'active'
    },
    masteredGoalsDuringPeriod: []
  });

  assert.equal(model.sessionCount, 2);
  assert.equal(model.averageFidelity, 60);
  assert.match(model.summaryText, /Average caregiver fidelity .* 60%/i);
});
