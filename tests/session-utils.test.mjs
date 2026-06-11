import test from 'node:test';
import assert from 'node:assert/strict';
import { removeBehaviorPointFromSession, removeTargetPointFromSession } from '../public/session-utils.js';

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
