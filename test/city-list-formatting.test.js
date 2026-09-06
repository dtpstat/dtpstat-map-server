import assert from 'node:assert/strict';
import test from 'node:test';
import { conditionalFormattingStyle } from '../public/js/city-list.js';

const rules = [
  {
    min: null,
    max: 90,
    bold: true,
    italic: false,
    underline: false,
    strike: false,
    color: '#3d1d1d',
    fontSizeStep: 0,
  },
  {
    min: 91,
    max: 200,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: '#e0ff00',
    fontSizeStep: 0,
  },
  {
    min: 201,
    max: null,
    bold: false,
    italic: true,
    underline: false,
    strike: false,
    color: '#00ff23',
    fontSizeStep: 0,
  },
];

test('conditional formatting chooses the expected inclusive range', () => {
  assert.deepEqual(conditionalFormattingStyle(74, rules), {
    fontWeight: '700',
    fontStyle: 'normal',
    textDecoration: 'none',
    color: '#3d1d1d',
    fontSize: '',
  });

  assert.deepEqual(conditionalFormattingStyle(92.2, rules), {
    fontWeight: '400',
    fontStyle: 'normal',
    textDecoration: 'none',
    color: '#e0ff00',
    fontSize: '',
  });

  assert.deepEqual(conditionalFormattingStyle(145.3, rules), {
    fontWeight: '400',
    fontStyle: 'normal',
    textDecoration: 'none',
    color: '#e0ff00',
    fontSize: '',
  });

  assert.deepEqual(conditionalFormattingStyle(201, rules), {
    fontWeight: '400',
    fontStyle: 'italic',
    textDecoration: 'none',
    color: '#00ff23',
    fontSize: '',
  });
});

test('conditional formatting uses first matching rule and can reset inherited emphasis', () => {
  const style = conditionalFormattingStyle(100, [
    {
      min: 0,
      max: 200,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      color: null,
      fontSizeStep: 0,
    },
    {
      min: 50,
      max: 150,
      bold: true,
      italic: true,
      underline: true,
      strike: false,
      color: '#ff0000',
      fontSizeStep: 2,
    },
  ]);

  assert.equal(style.fontWeight, '400');
  assert.equal(style.fontStyle, 'normal');
  assert.equal(style.textDecoration, 'none');
  assert.equal(style.color, '');
  assert.equal(style.fontSize, '');
});

test('conditional formatting ignores missing and unmatched values', () => {
  assert.equal(conditionalFormattingStyle(null, rules), null);
  assert.equal(conditionalFormattingStyle(Number.NaN, rules), null);
  assert.equal(conditionalFormattingStyle(90.5, rules), null);
});
