import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const website = new URL('../website/', import.meta.url);
const html = readFileSync(new URL('index.html', website), 'utf8');
const instagram = 'https://www.instagram.com/triumphbehavioralcare/';

test('footer and MedicalBusiness sameAs use the official Instagram profile', () => {
  const footer = html.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/i)?.[1];
  assert.ok(footer, 'Website footer must exist');
  const link = footer.match(/<a\b[^>]*href="([^"]+)"[^>]*>Instagram<\/a>/i);
  assert.ok(link, 'Footer Instagram link must exist');
  assert.equal(link[1], instagram);
  assert.match(link[0], /target="_blank"/);
  assert.match(link[0], /rel="[^"]*\bnoreferrer\b[^"]*"/);

  const schemas = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => JSON.parse(match[1]));
  const business = schemas.find((schema) => schema['@type'] === 'MedicalBusiness');
  assert.ok(business, 'MedicalBusiness structured data must exist and parse');
  assert.deepEqual(business.sameAs, [instagram]);
});

test('marketing website text files do not reintroduce the retired Instagram handle', () => {
  function check(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = new URL(entry.name, directory);
      if (entry.isDirectory()) {
        check(new URL(entry.name + '/', directory));
      } else if (/\.(html|js|css|json|md|txt|xml|svg)$/i.test(entry.name)) {
        assert.doesNotMatch(readFileSync(file, 'utf8'), /triumph_aba/i, file.pathname);
      }
    }
  }
  check(website);
});
