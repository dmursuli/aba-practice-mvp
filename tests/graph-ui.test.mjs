import test from 'node:test';
import assert from 'node:assert/strict';
import { graphScopeVisibility } from '../public/graph-ui.js';

test('skills tab does not render behavior graphs', () => {
  assert.deepEqual(graphScopeVisibility('skills'), {
    showSkillCharts: true,
    showBehaviorGraphs: false
  });
});

test('behaviors tab renders only behavior graphs', () => {
  assert.deepEqual(graphScopeVisibility('behaviors'), {
    showSkillCharts: false,
    showBehaviorGraphs: true
  });
});
