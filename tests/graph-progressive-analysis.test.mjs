import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGraphAnalysis} from '../public/charts.js';
import {buildCompactGraphAnalysisSentence} from '../public/report-utils.js';

function analyze(values, baseline = [], extra = {}) {
 const points=[...baseline,...values].map((y,i)=>({x:`2026-01-${String(i+1).padStart(2,'0')}`,y,...extra}));
 const phaseMarkers=[{date:`2026-01-${String(baseline.length+1).padStart(2,'0')}`,label:'Treatment',clinicalPhase:'intervention'}];
 const series=[{name:'Target',points}],options={graphType:'skill',phaseMarkers};
 const before=structuredClone({series,options});
 const result=buildGraphAnalysis(series,options).analyses[0];
 assert.deepEqual({series,options},before);
 return result;
}

test('zero valid Treatment observations cannot borrow level or variability from Baseline',()=>{
 const a=analyze([null,'',undefined],[20,30,40]);
 assert.equal(a.baselineLevel,30);
 for(const key of ['treatmentLevel','currentLevel','changeFromBaseline']) assert.equal(a[key],null);
 assert.equal(a.treatmentObservationCount,0);
 assert.equal(a.trendDisplay,'Unavailable');assert.equal(a.trendDirection,'Unavailable');
 assert.equal(a.variability,'Unavailable');assert.equal(a.stability,'Unavailable');
 assert.match(a.interpretation,/No Treatment data are available yet/);
 assert.equal(buildCompactGraphAnalysisSentence(a,'skill'),a.interpretation);
});

test('one Treatment observation at 90 is Stable with variability unavailable',()=>{
 const a=analyze([90]);
 assert.equal(a.treatmentLevel,90);assert.equal(a.currentLevel,90);
 assert.equal(a.trendDirection,'Stable');assert.equal(a.trendDisplay,'Stable');
 assert.equal(a.variability,'Unavailable');assert.equal(a.stability,'Insufficient data');
 assert.match(a.interpretation,/Trend is stable based on the available Treatment observation/);
 assert.match(a.interpretation,/Treatment performance is currently 90%/);
 assert.match(a.interpretation,/Variability cannot yet be determined from one Treatment observation/);
 assert.doesNotMatch(a.interpretation,/\b(increasing|decreasing|variable)\b/i);
 assert.equal(a.baselineLevel,null);assert.equal(a.changeFromBaseline,null);
 assert.match(a.interpretation,/Baseline unavailable/);
});

for(const [values,phrase] of [
 [[60,90],/increased from 60% to 90%.*30-percentage-point increase/],
 [[90,60],/decreased from 90% to 60%.*30-percentage-point decrease/],
 [[80,80],/remained unchanged at 80%/]
]) test(`two Treatment values ${values} classify direction independently of variability`,()=>{
 const a=analyze(values);
 assert.equal(a.currentLevel,values[1]);assert.equal(a.treatmentLevel,(values[0]+values[1])/2);
 assert.match(a.interpretation,phrase);
 const expected=values[1]>values[0]?"Increasing":values[1]<values[0]?"Decreasing":"Stable";
 assert.match(a.interpretation,new RegExp(`Trend is ${expected.toLowerCase()}`));
 assert.equal(a.trendDisplay,expected);
 assert.equal(a.trendDirection,expected);assert.equal(a.variability,'Unavailable');
 assert.doesNotMatch(a.interpretation,/\b(increasing|decreasing|stable|variable) trend/i);
 assert.equal(buildCompactGraphAnalysisSentence(a,'skill'),a.interpretation);
});

for(const [values,expected] of [
 [[50,51,52],'Stable'],[[50,52,54],'Increasing'],[[54,52,50],'Decreasing'],[[0,100,0,100,0,100],'Variable']
]) test(`three-plus formal ${expected} classification is preserved`,()=>{
 const a=analyze(values);
 assert.equal(a.trendDirection,expected);assert.equal(a.trendDisplay,expected);
 assert.match(a.variability,/^(low|moderate|high)$/);
});

test('zero is valid, missing values are not observations, and supported Baseline comparison remains',()=>{
 const a=analyze([null,'',0,undefined],[20]);
 assert.equal(a.treatmentObservationCount,1);assert.equal(a.currentLevel,0);
 assert.equal(a.treatmentLevel,0);assert.equal(a.changeFromBaseline,-20);
 assert.match(a.interpretation,/currently 0%/);
 assert.match(a.interpretation,/20-percentage-point decrease from Baseline/);
 const b=analyze([60,null,'',90]);
 assert.equal(b.treatmentObservationCount,2);assert.equal(b.trendDirection,'Increasing');
});

test('frequency descriptions do not mislabel counts as percentages',()=>{
 const a=analyze([3,6],[],{dataCollectionType:'frequency'});
 assert.match(a.interpretation,/increased from 3 to 6.*3-point increase/);
 assert.doesNotMatch(a.interpretation,/%|percentage-point/);
});

test('shared graph/report narratives avoid repetitive software-style fallback messages',()=>{
 for(const values of [[],[90],[60,90]]) {
  const a=analyze(values);
  const report=buildCompactGraphAnalysisSentence(a,'skill');
  assert.equal(report,a.interpretation);
  assert.doesNotMatch(report,/Variability: Variability requires|Trend: insufficient|Insufficient Treatment data for trend/i);
  assert.equal(a.trendConfidence,'');
 }
});

for(const [values,expected] of [[[50,50.1],'Increasing'],[[50,49.9],'Decreasing'],[[0],'Stable'],[[0,0],'Stable']]) {
 test(`sparse trend ${values} follows observed direction without the formal slope threshold`,()=>{
  const a=analyze(values);
  assert.equal(a.trendDirection,expected);assert.equal(a.trendDisplay,expected);
  assert.equal(a.variability,'Unavailable');
  assert.doesNotMatch(JSON.stringify(a),/insufficient[^".]*trend/i);
  assert.equal(buildCompactGraphAnalysisSentence(a,'skill'),a.interpretation);
 });
}
