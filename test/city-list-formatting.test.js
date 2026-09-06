import assert from 'node:assert/strict';
import test from 'node:test';
import { conditionalFormattingStyle } from '../public/js/city-list.js';

const rules = [
  {
    min: null,
    max: 91,
    bold: true,
    italic: false,
    underline: false,
    strike: false,
    color: '#3d1d1d',
    fontSizeStep: 0,
  },
  {
    min: 91,
    max: 201,
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

function expectedStyle({ bold = false, italic = false, color = '' } = {}) {
  return {
    fontWeight: bold ? '700' : '400',
    fontStyle: italic ? 'italic' : 'normal',
    textDecoration: 'none',
    color,
    fontSize: '',
  };
}

test('conditional formatting uses inclusive minimum and exclusive maximum', () => {
  assert.deepEqual(
    conditionalFormattingStyle(90.999, rules),
    expectedStyle({ bold: true, color: '#3d1d1d' }),
  );
  assert.deepEqual(
    conditionalFormattingStyle(91, rules),
    expectedStyle({ color: '#e0ff00' }),
  );
  assert.deepEqual(
    conditionalFormattingStyle(200.999, rules),
    expectedStyle({ color: '#e0ff00' }),
  );
  assert.deepEqual(
    conditionalFormattingStyle(201, rules),
    expectedStyle({ italic: true, color: '#00ff23' }),
  );
});

test('conditional formatting preserves the expected styles for representative values', () => {
  assert.deepEqual(
    conditionalFormattingStyle(74, rules),
    expectedStyle({ bold: true, color: '#3d1d1d' }),
  );
  assert.deepEqual(
    conditionalFormattingStyle(92.2, rules),
    expectedStyle({ color: '#e0ff00' }),
  );
  assert.deepEqual(
    conditionalFormattingStyle(145.3, rules),
    expectedStyle({ color: '#e0ff00' }),
  );
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

test('conditional formatting ignores missing values and values outside configured ranges', () => {
  const isolated = [{
    min: 10,
    max: 20,
    bold: true,
    italic: false,
    underline: false,
    strike: false,
    color: null,
    fontSizeStep: 0,
  }];

  assert.equal(conditionalFormattingStyle(null, rules), null);
  assert.equal(conditionalFormattingStyle(Number.NaN, rules), null);
  assert.equal(conditionalFormattingStyle(9.999, isolated), null);
  assert.equal(conditionalFormattingStyle(20, isolated), null);
  assert.notEqual(conditionalFormattingStyle(10, isolated), null);
  assert.notEqual(conditionalFormattingStyle(19.999, isolated), null);
});
