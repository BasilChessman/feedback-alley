import { useContext, useEffect, useMemo, useState } from 'react';
import type { Block, Values } from '../types';
import { api } from '../lib/api';
import { collectRefs, isVariableName, parseRefs, refKey, replaceOutsideRefs, splitKey } from '../lib/variables';
import { collectTexts, retargetBlock } from '../lib/retarget';
import { useEditor } from './EditorCtx';
import { useActions } from './actions';
import { Section, ValuesCtx } from './fields';

interface Ref {
  key: string;
  conn: number; // connection index ([1]$(...)); 0 = default
  variable: string; // "device1:status"
  group: string; // "device1"
}

// Every variable a block (or several) uses, and its name and text, each with an
// editable copy. Rename the connection once ("device1" -> "device2"), find and
// replace across everything, or edit one by one; then apply in place or make a
// copy with the changes. Variables are renamed wherever they're used: text,
// images, bars, headers and feedback rules.
export function VariablesPanel({ blocks }: { blocks: Block[] }) {
  const { updateScreen } = useEditor();
  const actions = useActions();
  const values = useContext(ValuesCtx);
  const refs = useMemo<Ref[]>(
    () =>
      collectRefs(blocks).map((key) => {
        const { conn, variable } = splitKey(key);
        return { key, conn, variable, group: variable.slice(0, variable.indexOf(':')) };
      }),
    [blocks],
  );
  const groups = useMemo(() => {
    const out = new Map<string, Ref[]>();
    for (const r of refs) {
      const id = refKey(r.conn, r.group);
      out.set(id, [...(out.get(id) ?? []), r]);
    }
    return [...out.entries()];
  }, [refs]);

  // text with words of its own (not just variables) and every block name
  const texts = useMemo(
    () => collectTexts(blocks).filter((t) => t.path[0] === 'name' || /[\p{L}\p{N}]/u.test(parseRefs(t.text).reduce((s, r) => s.replace(r.full, ''), t.text))),
    [blocks],
  );

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const reset = () => {
    setDrafts({});
    setTextDrafts({});
  };
  // a different selection starts over
  useEffect(reset, [blocks.map((b) => b.id).join()]);

  const draftOf = (r: Ref) => drafts[r.key] ?? r.variable;
  const renames: Record<string, string> = {};
  for (const r of refs) if (draftOf(r).trim() !== r.variable) renames[r.key] = draftOf(r).trim();
  const textEdits: Record<string, string> = {};
  for (const t of texts) if ((textDrafts[t.id] ?? t.text) !== t.text) textEdits[t.id] = textDrafts[t.id];
  const changed = Object.keys(renames).length + Object.keys(textEdits).length;
  const invalid = Object.values(renames).some((v) => !isVariableName(v));

  // Look up the new names so a typo shows before it's applied.
  const [checked, setChecked] = useState<Values>({});
  const lookup = Object.entries(renames)
    .filter(([, v]) => isVariableName(v))
    .map(([k, v]) => refKey(splitKey(k).conn, v))
    .sort()
    .join('\n');
  useEffect(() => {
    if (!lookup) return;
    const t = setTimeout(() => {
      api.variables(lookup.split('\n')).then((res) => setChecked((prev) => ({ ...prev, ...res.values })), () => {});
    }, 400);
    return () => clearTimeout(t);
  }, [lookup]);

  // A connection's name as the edited names below it have it, if they agree.
  const groupOf = (list: Ref[]) => {
    const names = new Set(list.map((r) => draftOf(r)).map((d) => (d.includes(':') ? d.slice(0, d.indexOf(':')) : null)));
    const [only] = names;
    return names.size === 1 && only != null ? only : list[0].group;
  };
  const setGroup = (list: Ref[], to: string) => {
    const from = groupOf(list);
    const next = { ...drafts };
    for (const r of list) {
      const d = draftOf(r);
      if (d.startsWith(`${from}:`)) next[r.key] = `${to}${d.slice(from.length)}`;
    }
    setDrafts(next);
  };

  const replaceAll = () => {
    if (!find) return;
    const next = { ...drafts };
    for (const r of refs) next[r.key] = draftOf(r).split(find).join(replace);
    setDrafts(next);
    const nextText = { ...textDrafts };
    for (const t of texts) nextText[t.id] = replaceOutsideRefs(textDrafts[t.id] ?? t.text, find, replace);
    setTextDrafts(nextText);
  };

  const ids = blocks.map((b) => b.id);
  const apply = () => {
    updateScreen((s) => s.blocks.forEach((b) => ids.includes(b.id) && retargetBlock(b, ids.indexOf(b.id), textEdits, renames)));
    reset();
  };
  const duplicate = () => {
    actions.duplicateBlocks(ids, (c, i) => retargetBlock(c, i, textEdits, renames));
    reset();
  };

  const many = blocks.length > 1;
  return (
    <Section title="Find & Replace" defaultOpen={false} remember="variables">
      <p className="muted small">
        Edit the copies below, then apply them here or make a duplicate with the changes. Variables are renamed everywhere
        they’re used, including images, bars and feedback rules.
      </p>
      <div className="vars-find">
        <input type="text" value={find} placeholder="Find" onChange={(e) => setFind(e.target.value)} />
        <span className="muted">→</span>
        <input
          type="text"
          value={replace}
          placeholder="Replace with"
          onChange={(e) => setReplace(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && replaceAll()}
        />
        <button className="small" disabled={!find} onClick={replaceAll} title="Replace in every variable name and text below">Replace</button>
      </div>

      <h4 className="subhead">Variables ({refs.length})</h4>
      {refs.length === 0 && <p className="muted small">No variables in {many ? 'these blocks' : 'this block'} yet.</p>}
      {groups.map(([id, list]) => {
        const g = groupOf(list);
        return (
          <div key={id} className="vars-group">
            <label className="vars-conn">
              <span className="muted small">Connection{list[0].conn > 0 ? ` [${list[0].conn}]` : ''}</span>
              <input
                type="text"
                value={g}
                className={`mono${g !== list[0].group ? ' changed' : ''}${g ? '' : ' bad'}`}
                onChange={(e) => setGroup(list, e.target.value.replace(/[:)\s]/g, ''))}
              />
            </label>
            {list.map((r) => {
              const d = draftOf(r);
              const isChanged = d.trim() !== r.variable;
              const ok = isVariableName(d.trim());
              const newKey = refKey(r.conn, d.trim());
              const v = isChanged ? checked[newKey] : values[r.key];
              return (
                <div key={r.key} className="vars-row">
                  <span className="vars-was mono" title={r.key}>{r.variable}</span>
                  <input
                    type="text"
                    value={d}
                    className={`mono${isChanged ? ' changed' : ''}${ok ? '' : ' bad'}`}
                    onChange={(e) => setDrafts({ ...drafts, [r.key]: e.target.value })}
                  />
                  {!ok ? (
                    <span className="vars-status bad">Use connection:name</span>
                  ) : v != null ? (
                    <span className="live-preview" title="Current value">→ {v === '' ? <em>(empty)</em> : v}</span>
                  ) : (
                    isChanged && newKey in checked && <span className="vars-status warn">Not found in Companion</span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      <h4 className="subhead">Text ({texts.length})</h4>
      {texts.some((t) => t.text.includes('$(')) && <p className="muted small">Variables in this text follow the names above.</p>}
      {texts.map((t) => {
        const d = textDrafts[t.id] ?? t.text;
        return (
          <div key={t.id} className="vars-row">
            <span className="vars-was" title={t.label}>{t.label}</span>
            <textarea
              value={d}
              rows={Math.min(4, d.split('\n').length)}
              className={d !== t.text ? 'changed' : ''}
              onChange={(e) => setTextDrafts({ ...textDrafts, [t.id]: e.target.value })}
            />
          </div>
        );
      })}

      <span className="btn-row vars-actions">
        <button className="primary" disabled={!changed || invalid} onClick={duplicate}>Duplicate with changes</button>
        <button disabled={!changed || invalid} onClick={apply}>Apply</button>
        {changed > 0 && <button className="link" onClick={reset}>Reset</button>}
      </span>
      {changed > 0 && <p className="muted small">{changed} change{changed > 1 ? 's' : ''} ready.</p>}
    </Section>
  );
}
