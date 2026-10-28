import type { Condition, FeedbackRule, Operator, StyleOverride, Values } from '../types';
import { resolveText } from './variables';

export const OPERATORS: { op: Operator; label: string; unary?: boolean }[] = [
  { op: '==', label: '=' },
  { op: '!=', label: '≠' },
  { op: '>', label: '>' },
  { op: '>=', label: '≥' },
  { op: '<', label: '<' },
  { op: '<=', label: '≤' },
  { op: 'contains', label: 'contains' },
  { op: '!contains', label: 'does not contain' },
  { op: 'empty', label: 'is empty', unary: true },
  { op: '!empty', label: 'is not empty', unary: true },
];

const isNum = (s: string) => s.trim() !== '' && !isNaN(Number(s));

// Numeric comparison when both sides are numbers, otherwise string comparison.
// "true"/"false"/"on"/"off" style values compare as plain strings.
export function compare(left: string, op: Operator, right: string): boolean {
  const numeric = isNum(left) && isNum(right);
  const a: string | number = numeric ? Number(left) : left;
  const b: string | number = numeric ? Number(right) : right;
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case 'contains': return left.toLowerCase().includes(right.toLowerCase());
    case '!contains': return !left.toLowerCase().includes(right.toLowerCase());
    case 'empty': return left.trim() === '';
    case '!empty': return left.trim() !== '';
  }
}

export function evalCondition(c: Condition, values: Values) {
  return compare(resolveText(c.left, values), c.op, resolveText(c.right, values));
}

export function ruleMatches(rule: FeedbackRule, values: Values) {
  const usable = rule.conditions.filter((c) => c.left.trim() !== '');
  if (usable.length === 0) return false;
  return rule.match === 'any'
    ? usable.some((c) => evalCondition(c, values))
    : usable.every((c) => evalCondition(c, values));
}

// Rules are checked top to bottom; for each property the first matching rule wins.
export function applyRules(rules: FeedbackRule[] | undefined, values: Values): StyleOverride {
  const out: StyleOverride = {};
  for (const rule of rules || []) {
    if (!ruleMatches(rule, values)) continue;
    for (const [k, v] of Object.entries(rule.set) as [keyof StyleOverride, unknown][]) {
      if (v !== undefined && out[k] === undefined) (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}
