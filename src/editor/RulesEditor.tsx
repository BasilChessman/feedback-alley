import { useContext } from 'react';
import type { Condition, FeedbackRule, FlashPart, StyleOverride } from '../types';
import { OPERATORS, ruleMatches } from '../lib/rules';
import { newRule } from '../lib/defaults';
import { FLASH_PART_LABELS, FLASH_SPEEDS, flashSpec, newFlash } from '../lib/flash';
import { ColorField, Segmented, Select, Slider, TextField, ValuesCtx } from './fields';
import { RichTextField } from './RichTextField';

export type RuleProp = keyof StyleOverride;

const PROP_LABELS: Record<RuleProp, string> = {
  fill: 'Fill color',
  textColor: 'Text color',
  borderColor: 'Border color',
  background: 'Background color',
  opacity: 'Opacity',
  visible: 'Visibility',
  flash: 'Flash',
  text: 'Replace text',
  headerVisible: 'Header visibility',
  headerFill: 'Header fill',
  headerTextColor: 'Header text color',
  headerText: 'Replace header text',
};

const PROP_DEFAULTS: Required<StyleOverride> = {
  fill: '#d83a3a',
  textColor: '#ffffff',
  borderColor: '#ffcc00',
  background: '#d83a3a',
  opacity: 50,
  visible: false,
  flash: newFlash(),
  text: '',
  headerVisible: true,
  headerFill: '#d83a3a',
  headerTextColor: '#ffffff',
  headerText: '',
};

// Conditional feedback: "when <conditions> then set <properties>".
// flashParts: the parts of this item a Flash rule can flash.
export function RulesEditor({ rules, onChange, props, flashParts = ['all'] }: {
  rules: FeedbackRule[]; onChange: (r: FeedbackRule[]) => void; props: RuleProp[]; flashParts?: FlashPart[];
}) {
  const values = useContext(ValuesCtx);
  const set = (i: number, fn: (r: FeedbackRule) => void) => {
    const next = structuredClone(rules);
    fn(next[i]);
    onChange(next);
  };
  const move = (i: number, d: number) => {
    const next = [...rules];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="rules">
      {rules.length === 0 && (
        <p className="muted small">
          Rules change this item’s look when variables match, e.g. turn red when <code>$(atem:pgm)</code> = 3.
        </p>
      )}
      {rules.map((rule, i) => {
        const active = ruleMatches(rule, values);
        return (
          <div key={rule.id} className={`rule${active ? ' active' : ''}`}>
            <div className="rule-head">
              <span className="rule-dot" title={active ? 'Matching now' : 'Not matching'} />
              <strong>Rule {i + 1}</strong>
              {rule.conditions.length > 1 && (
                <Select
                  value={rule.match}
                  onChange={(v) => set(i, (r) => (r.match = v))}
                  options={[{ value: 'all', label: 'all match' }, { value: 'any', label: 'any matches' }]}
                />
              )}
              <span className="spacer" />
              <button className="icon" title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className="icon" title="Move down" onClick={() => move(i, 1)} disabled={i === rules.length - 1}>↓</button>
              <button className="icon danger" title="Delete rule" onClick={() => onChange(rules.filter((_, j) => j !== i))}>✕</button>
            </div>

            <div className="rule-label">When</div>
            {rule.conditions.map((c, ci) => (
              <ConditionRow
                key={ci}
                c={c}
                onChange={(nc) => set(i, (r) => (r.conditions[ci] = nc))}
                onRemove={rule.conditions.length > 1 ? () => set(i, (r) => r.conditions.splice(ci, 1)) : undefined}
              />
            ))}
            <button className="link" onClick={() => set(i, (r) => r.conditions.push({ left: '', op: '==', right: '' }))}>+ condition</button>

            <div className="rule-label">Then</div>
            {props.map((p) => {
              const on = rule.set[p] !== undefined;
              return (
                <div key={p} className="rule-prop">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => set(i, (r) => {
                        if (e.target.checked) (r.set as Record<string, unknown>)[p] = PROP_DEFAULTS[p];
                        else delete r.set[p];
                      })}
                    />
                    <span>{PROP_LABELS[p]}</span>
                  </label>
                  {on && (p === 'flash'
                    ? <FlashEditor value={rule.set.flash} parts={flashParts} onChange={(v) => set(i, (r) => (r.set.flash = v))} />
                    : <PropEditor prop={p} value={rule.set[p]} onChange={(v) => set(i, (r) => ((r.set as Record<string, unknown>)[p] = v))} />)}
                </div>
              );
            })}
          </div>
        );
      })}
      <button onClick={() => onChange([...rules, newRule()])}>+ Add rule</button>
      {rules.length > 1 && <p className="muted small">Rules are checked top to bottom; for each property the first matching rule wins.</p>}
    </div>
  );
}

function ConditionRow({ c, onChange, onRemove }: { c: Condition; onChange: (c: Condition) => void; onRemove?: () => void }) {
  const unary = OPERATORS.find((o) => o.op === c.op)?.unary;
  return (
    <div className="condition">
      <TextField value={c.left} onChange={(left) => onChange({ ...c, left })} placeholder="$(connection:variable)" />
      <div className="condition-op">
        <Select value={c.op} onChange={(op) => onChange({ ...c, op })} options={OPERATORS.map((o) => ({ value: o.op, label: o.label }))} />
        {!unary && <TextField value={c.right} onChange={(right) => onChange({ ...c, right })} placeholder="value or $(var)" />}
        {onRemove && <button className="icon danger" title="Remove condition" onClick={onRemove}>✕</button>}
      </div>
    </div>
  );
}

function PropEditor({ prop, value, onChange }: { prop: RuleProp; value: unknown; onChange: (v: unknown) => void }) {
  switch (prop) {
    case 'fill':
    case 'headerFill':
    case 'headerTextColor':
    case 'textColor':
    case 'borderColor':
    case 'background':
      return <ColorField value={String(value)} onChange={onChange} />;
    case 'opacity':
      return <Slider value={Number(value)} onChange={onChange} />;
    case 'visible':
    case 'headerVisible':
      return (
        <Select value={value ? 'show' : 'hide'} onChange={(v) => onChange(v === 'show')} options={[{ value: 'hide', label: 'Hide' }, { value: 'show', label: 'Show' }]} />
      );
    case 'text':
    case 'headerText':
      return <RichTextField value={String(value)} onChange={onChange} placeholder="Text (variables and formatting allowed)" />;
  }
}

// What flashes (one or more parts, or the whole item), blink or alternate
// with a color, and how fast.
function FlashEditor({ value, parts, onChange }: { value: StyleOverride['flash']; parts: FlashPart[]; onChange: (v: StyleOverride['flash']) => void }) {
  const f = flashSpec(value) ?? { ...newFlash(), parts: [] };
  const toggle = (p: FlashPart) => {
    const has = f.parts.includes(p);
    // the whole item and its parts don't mix
    const next = p === 'all' ? (has ? [] : ['all' as const]) : has ? f.parts.filter((x) => x !== p) : [...f.parts.filter((x) => x !== 'all'), p];
    onChange({ ...f, parts: next });
  };
  const onlyWhole = f.parts.length === 1 && f.parts[0] === 'all';
  return (
    <div className="flash-editor">
      <span className="btn-row tight flash-parts">
        {parts.map((p) => (
          <button key={p} type="button" className={f.parts.includes(p) ? 'on' : ''} onClick={() => toggle(p)}>{FLASH_PART_LABELS[p]}</button>
        ))}
      </span>
      {f.parts.length === 0 && <span className="muted small">Pick what flashes.</span>}
      {f.parts.length > 0 && !onlyWhole && (
        <>
          <Segmented
            value={f.color ? 'color' : 'blink'}
            onChange={(m) => onChange({ ...f, color: m === 'color' ? '#ffcc00' : '' })}
            options={[{ value: 'blink', label: 'Blink', title: 'Disappears and comes back' }, { value: 'color', label: 'Alternate color', title: 'Switches to another color and back' }]}
          />
          {f.color && <ColorField value={f.color} onChange={(c) => onChange({ ...f, color: c })} />}
        </>
      )}
      {onlyWhole && <span className="muted small">The whole item fades in and out.</span>}
      <Segmented
        value={String(f.speed)}
        onChange={(v) => onChange({ ...f, speed: Number(v) })}
        options={FLASH_SPEEDS.map((s) => ({ value: String(s.value), label: s.label }))}
      />
    </div>
  );
}
