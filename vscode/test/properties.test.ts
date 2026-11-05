import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorFormats, nodeSections, parseColor, styleSections, tokenSections } from '../webview/properties.ts';
import type { PropertySection } from '../webview/properties.ts';

const section = (sections: PropertySection[], title: string) => {
  const found = sections.find((section) => section.title === title);
  assert.ok(found, `no ${title} section in ${sections.map((s) => s.title).join(', ')}`);
  return found;
};
const value = (sections: PropertySection[], title: string, label: string) =>
  section(sections, title).rows.find((row) => row.label === label)?.value;

test('groups a layer’s fields into sections, skipping empty ones', () => {
  const sections = nodeSections({
    id: 'n2',
    name: 'Card',
    type: 'rectangle',
    x: 20,
    y: 20.5,
    width: 60,
    height: 40,
    rotation: 15,
    opacity: 0.5,
    corners: { radius: [8, 8, 0, 0], style: 'smooth', smoothing: 0.6 },
    fills: [{ type: 'solid', color: '#3b5bdb', token: 'Brand/Blue' }],
  });
  assert.deepEqual(
    sections.map((s) => s.title),
    ['Layer', 'Position & Size', 'Appearance', 'Fills'],
  );
  assert.equal(value(sections, 'Position & Size', 'Y'), '20.5px');
  assert.equal(value(sections, 'Position & Size', 'Rotation'), '15°');
  assert.equal(value(sections, 'Appearance', 'Opacity'), '50%');
  assert.equal(value(sections, 'Appearance', 'Corner radius'), '8px 8px 0px 0px');
  assert.equal(value(sections, 'Appearance', 'Corner style'), 'Smooth');
  assert.equal(value(sections, 'Appearance', 'Smoothing'), '60%');
  const fill = section(sections, 'Fills').rows[0];
  assert.deepEqual(fill, { label: 'Solid', value: '#3b5bdb', swatch: ['#3b5bdb'], token: 'Brand/Blue' });
});

test('text, typography, borders, effects and auto layout', () => {
  const sections = nodeSections({
    type: 'text',
    text: 'Hello\nworld',
    textStyle: { fontFamily: 'Inter', fontWeight: 600, fontSize: 14, lineHeight: 20, color: '#111111' },
    borders: [{ type: 'solid', color: '#000000', position: 'inside', thickness: 1 }],
    effects: {
      shadows: [{ x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0, 0, 0, 0.12)' }],
      blurs: [{ type: 'background', radius: 20 }],
      css: { boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)' },
    },
    layout: { mode: 'column', gap: 8, padding: '8px 16px' },
  });
  assert.equal(value(sections, 'Text', 'Content'), 'Hello\nworld');
  assert.equal(value(sections, 'Typography', 'Font'), 'Inter');
  assert.equal(value(sections, 'Typography', 'Weight'), '600');
  assert.equal(value(sections, 'Typography', 'Color'), '#111111');
  assert.equal(section(sections, 'Borders').rows[0].label, '1px inside · Solid');
  assert.equal(value(sections, 'Effects', 'Drop shadow'), '0px 4px 12px 0px rgba(0, 0, 0, 0.12)');
  assert.equal(value(sections, 'Effects', 'Background blur'), '20px');
  assert.equal(value(sections, 'Effects', 'box-shadow'), '0 4px 12px rgba(0, 0, 0, 0.12)');
  assert.equal(value(sections, 'Auto Layout', 'Direction'), 'Vertical (column)');
  assert.equal(value(sections, 'Auto Layout', 'Padding'), '8px 16px');
});

test('gradients show their stops as a swatch', () => {
  const sections = nodeSections({
    fills: [
      {
        type: 'linear',
        css: 'linear-gradient(180deg, #fff 0%, #000 100%)',
        stops: [
          { position: 0, color: '#ffffff' },
          { position: 1, color: '#000000' },
        ],
      },
    ],
  });
  const row = section(sections, 'Fills').rows[0];
  assert.equal(row.label, 'Linear gradient');
  assert.equal(row.value, 'linear-gradient(180deg, #fff 0%, #000 100%)');
  assert.deepEqual(row.swatch, ['#ffffff', '#000000']);
});

test('reused style values show as the field they stand in for', () => {
  const sections = styleSections('fill', [{ type: 'solid', color: '#ffffff' }]);
  assert.deepEqual(
    sections.map((s) => s.title),
    ['Fills'],
  );
  assert.deepEqual(styleSections('unknown', {}), []);
});

test('colors parse and convert for copying', () => {
  assert.deepEqual(parseColor('#3b5bdb'), [59, 91, 219, 1]);
  assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('rgba(0, 0, 0, 0.5)'), [0, 0, 0, 0.5]);
  assert.equal(parseColor('red'), undefined);
  assert.deepEqual(
    colorFormats('#3b5bdb').map((row) => row.value),
    ['#3B5BDB', 'rgb(59, 91, 219)', 'hsl(228, 69%, 55%)'],
  );
  assert.deepEqual(
    colorFormats('rgba(0, 0, 0, 0.5)').map((row) => row.value),
    ['#00000080', 'rgba(0, 0, 0, 0.5)', 'hsla(0, 0%, 0%, 0.5)'],
  );
});

test('color tokens list their formats and layers', () => {
  const sections = tokenSections('Brand/Blue', '#3b5bdb', ['Cards']);
  assert.equal(value(sections, 'Color', 'Hex'), '#3B5BDB');
  assert.equal(value(sections, 'Used By', '1'), 'Cards');
});
