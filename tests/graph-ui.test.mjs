import test from 'node:test';
import assert from 'node:assert/strict';
import { graphScopeVisibility } from '../public/graph-ui.js';

test('skills tab does not render behavior graphs', () => {
  assert.deepEqual(graphScopeVisibility('skills'), {
    showSkillCharts: true,
    showBehaviorGraphs: false,
    showParentTrainingCharts: false
  });
});

test('behaviors tab renders only behavior graphs', () => {
  assert.deepEqual(graphScopeVisibility('behaviors'), {
    showSkillCharts: false,
    showBehaviorGraphs: true,
    showParentTrainingCharts: false
  });
});

test('parent-training tab renders only caregiver-training graphs', () => {
  assert.deepEqual(graphScopeVisibility('parent'), {
    showSkillCharts: false,
    showBehaviorGraphs: false,
    showParentTrainingCharts: true
  });
});
