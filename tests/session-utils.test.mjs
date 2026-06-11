import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availableBehaviorsForSession,
  availableTargetsForSession,
  dedupeBehaviorEntries,
  dedupeTargetEntries,
  duplicateBehaviorIds,
  duplicateTargetIdsFromPrograms,
  removeBehaviorPointFromSession,
  removeTargetPointFromSession
} from '../public/session-utils.js';

test('user can delete an individual skill-acquisition data point and empty programs are removed', () => {
  const session = {
    id: 'session-1',
    programs: [
      {
        programId: 'program-a',
        targets: [
          { targetId: 'target-1', independence: 80 },
          { targetId: 'target-2', independence: 60 }
        ]
      },
      {
        programId: 'program-b',
        targets: [
          { targetId: 'target-3', independence: 50 }
        ]
      }
    ]
  };

  const singleDelete = removeTargetPointFromSession(session, 'program-a', 'target-1');
  assert.equal(singleDelete.removed, true);
  assert.deepEqual(singleDelete.session.programs[0].targets.map((target) => target.targetId), ['target-2']);

  const finalDelete = removeTargetPointFromSession(singleDelete.session, 'program-b', 'target-3');
  assert.equal(finalDelete.removed, true);
  assert.equal(finalDelete.session.programs.some((program) => program.programId === 'program-b'), false);
});

test('user can delete an individual behavior-reduction data point', () => {
  const session = {
    id: 'session-2',
    behaviors: [
      { behaviorId: 'behavior-a', frequency: 3 },
      { behaviorId: 'behavior-b', frequency: 1 }
    ]
  };

  const result = removeBehaviorPointFromSession(session, 'behavior-a');
  assert.equal(result.removed, true);
  assert.deepEqual(result.session.behaviors.map((behavior) => behavior.behaviorId), ['behavior-b']);
});

test('deleting a missing data point leaves session data unchanged', () => {
  const session = {
    id: 'session-3',
    programs: [{ programId: 'program-a', targets: [{ targetId: 'target-1', independence: 80 }] }],
    behaviors: [{ behaviorId: 'behavior-a', frequency: 2 }]
  };

  const targetDelete = removeTargetPointFromSession(session, 'program-a', 'target-missing');
  assert.equal(targetDelete.removed, false);
  assert.equal(targetDelete.session, session);

  const behaviorDelete = removeBehaviorPointFromSession(session, 'behavior-missing');
  assert.equal(behaviorDelete.removed, false);
  assert.equal(behaviorDelete.session, session);
});

test('auto-populated session rows can be deduplicated by stable target id', () => {
  const entries = [
    { programId: 'program-a', targetId: 'target-1', independence: 80 },
    { programId: 'program-a', targetId: 'target-1', independence: 60 },
    { programId: 'program-b', targetId: 'target-2', independence: 50 }
  ];

  const result = dedupeTargetEntries(entries);
  assert.deepEqual(result.map((entry) => entry.targetId), ['target-1', 'target-2']);
  assert.equal(result[0].independence, 80);
});

test('manual add excludes targets that are already in the session and restores them after removal', () => {
  const targets = [
    { id: 'target-1', name: 'Mand 1' },
    { id: 'target-2', name: 'Mand 2' },
    { id: 'target-3', name: 'Mand 3' }
  ];

  const selectedIds = new Set(['target-1', 'target-2']);
  const availableBeforeDelete = availableTargetsForSession(targets, selectedIds);
  assert.deepEqual(availableBeforeDelete.map((target) => target.id), ['target-3']);

  const availableAfterDelete = availableTargetsForSession(targets, new Set(['target-2']));
  assert.deepEqual(availableAfterDelete.map((target) => target.id), ['target-1', 'target-3']);
});

test('attempting to re-use a selected target or behavior is detectable by stable ids', () => {
  const programs = [
    { programId: 'program-a', targets: [{ targetId: 'target-1' }, { targetId: 'target-2' }] },
    { programId: 'program-b', targets: [{ targetId: 'target-1' }] }
  ];
  const behaviors = [{ behaviorId: 'behavior-1' }, { behaviorId: 'behavior-1' }];

  assert.deepEqual(duplicateTargetIdsFromPrograms(programs), ['target-1']);
  assert.deepEqual(duplicateBehaviorIds(behaviors), ['behavior-1']);
});

test('behavior availability excludes selected rows and reopens after deletion', () => {
  const behaviors = [
    { id: 'behavior-1', name: 'Aggression' },
    { id: 'behavior-2', name: 'Elopement' }
  ];
  assert.deepEqual(
    availableBehaviorsForSession(behaviors, new Set(['behavior-1'])).map((behavior) => behavior.id),
    ['behavior-2']
  );
  assert.deepEqual(
    availableBehaviorsForSession(behaviors, new Set()).map((behavior) => behavior.id),
    ['behavior-1', 'behavior-2']
  );
});

test('legacy duplicate behavior rows can be displayed safely without double-counting graph inputs', () => {
  const behaviors = [
    { behaviorId: 'behavior-1', frequency: 3 },
    { behaviorId: 'behavior-1', frequency: 9 },
    { behaviorId: 'behavior-2', frequency: 1 }
  ];

  const result = dedupeBehaviorEntries(behaviors);
  assert.deepEqual(result.map((behavior) => behavior.behaviorId), ['behavior-1', 'behavior-2']);
  assert.equal(result[0].frequency, 3);
});
