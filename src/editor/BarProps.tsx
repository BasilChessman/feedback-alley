import { useContext } from 'react';
import type { BarLayer } from '../types';
import { activeThreshold, formatTime, readBar } from '../lib/bar';
import { ColorField, NumberField, Row, Section, Segmented, Select, TextField, Toggle, ValuesCtx } from './fields';

type Set = (fn: (l: BarLayer) => void) => void;

const SOURCES: { value: BarLayer['source']; label: string }[] = [
  { value: 'value', label: 'A number (min to max)' },
  { value: 'remaining', label: 'Countdown (time left)' },
  { value: 'elapsed', label: 'Time elapsed' },
];

export function BarProps({ layer, set }: { layer: BarLayer; set: Set }) {
  const values = useContext(ValuesCtx);
  const timed = layer.source !== 'value';
  const reading = readBar(layer, values);

  return (
    <>
      <Section title="Bar / meter">
        <Row label="Shows" hint={timed ? `Fills from empty to full as the time ${layer.source === 'remaining' ? 'counts down to 0' : 'reaches the duration'}` : undefined}>
          <Select value={layer.source} onChange={(v) => set((l) => (l.source = v))} options={SOURCES} />
        </Row>
        {!timed ? (
          <>
            <Row label="Value"><TextField value={layer.value} onChange={(v) => set((l) => (l.value = v))} placeholder="$(connection:variable)" /></Row>
            <Row label="Range">
              <span className="pair">
                <NumberField value={layer.min} onChange={(v) => set((l) => (l.min = v))} />
                <span>to</span>
                <NumberField value={layer.max} onChange={(v) => set((l) => (l.max = v))} />
              </span>
            </Row>
          </>
        ) : (
          <>
            <Row label={layer.source === 'remaining' ? 'Time left' : 'Time elapsed'}>
              <TextField value={layer.value} onChange={(v) => set((l) => (l.value = v))} placeholder="$(connection:time_remaining)" />
            </Row>
            <Row label="Duration" hint="A variable, or typed like 2:20 or 1:02:20">
              <TextField value={layer.duration} onChange={(v) => set((l) => (l.duration = v))} placeholder="$(connection:duration) or 2:20" />
            </Row>
            <Row label="Plain numbers" hint="Times like 2:20 always work; this is for variables that give a bare number">
              <Segmented
                value={layer.timeUnit}
                onChange={(v) => set((l) => (l.timeUnit = v))}
                options={[{ value: 's', label: 'Seconds' }, { value: 'ms', label: 'Milliseconds' }]}
              />
            </Row>
            <Row label="Smooth" hint="Glides between once-a-second updates">
              <Toggle value={layer.smooth} onChange={(v) => set((l) => (l.smooth = v))} />
            </Row>
          </>
        )}
        <Row label="Now">
          <span className="muted small">
            {isNaN(reading.progress)
              ? timed ? 'Waiting for a time and a duration…' : 'Waiting for a number…'
              : <>
                  {Math.round(reading.progress * 100)}% full
                  {timed && ` · ${formatTime(reading.time!)} ${layer.source === 'remaining' ? 'left' : 'elapsed'} of ${formatTime(reading.duration!)}`}
                </>}
          </span>
        </Row>
        <Row label="Direction">
          <Segmented
            value={layer.direction}
            onChange={(v) => set((l) => (l.direction = v))}
            options={[{ value: 'right', label: '→' }, { value: 'left', label: '←' }, { value: 'up', label: '↑' }, { value: 'down', label: '↓' }]}
          />
        </Row>
        <Row label="Reverse" hint="Start full and empty out instead">
          <Toggle value={layer.reverse} onChange={(v) => set((l) => (l.reverse = v))} />
        </Row>
        <Row label="Fill"><ColorField value={layer.fill} onChange={(v) => set((l) => (l.fill = v))} /></Row>
        <Row label="Track"><ColorField value={layer.track} onChange={(v) => set((l) => (l.track = v))} /></Row>
      </Section>
      <ThresholdsSection layer={layer} set={set} activeIndex={activeThreshold(layer, reading)} />
    </>
  );
}

function ThresholdsSection({ layer, set, activeIndex }: { layer: BarLayer; set: Set; activeIndex: number }) {
  const timed = layer.source !== 'value';
  const percent = layer.thresholdMode === 'percent';
  const unitLabel = percent ? '% full' : layer.source === 'remaining' ? 'left' : layer.source === 'elapsed' ? 'elapsed' : '';
  const placeholder = percent ? '80' : timed ? '0:30' : '';
  const help = percent
    ? 'The fill changes color once the bar is this full.'
    : layer.source === 'remaining'
      ? 'The fill changes color once this much time is left, e.g. 0:30.'
      : layer.source === 'elapsed'
        ? 'The fill changes color once this much time has passed.'
        : 'The fill changes color once the value reaches each point.';
  const add = () =>
    set((l) => {
      const n = Math.min(l.thresholds.length, 2);
      const at = percent ? ['80', '90', '100'][n]
        : timed ? ['0:30', '0:10', '0:05'][n]
        : String(+(l.min + (l.max - l.min) * [0.8, 0.9, 1][n]).toFixed(2));
      l.thresholds.push({ at, color: ['#ffb020', '#ff4d4d', '#ff2d95'][n] });
    });

  return (
    <Section
      title={`Color thresholds${layer.thresholds.length ? ` (${layer.thresholds.length})` : ''}`}
      defaultOpen={layer.thresholds.length > 0}
    >
      <Row label="Measured in">
        <Segmented
          value={layer.thresholdMode}
          onChange={(v) => set((l) => (l.thresholdMode = v))}
          options={[
            { value: 'absolute', label: timed ? 'Time' : 'Value', title: timed ? 'Time left/elapsed, like 0:30' : 'The same numbers as the range' },
            { value: 'percent', label: '% of bar', title: 'Percent of the way along the bar' },
          ]}
        />
      </Row>
      <p className="muted small">{help} The furthest point reached wins. Feedback rules that set the fill override thresholds.</p>
      {layer.thresholds.map((th, i) => (
        <div key={i} className={`threshold${i === activeIndex ? ' active' : ''}`}>
          <span className="rule-dot" title={i === activeIndex ? 'Active now' : 'Not active'} />
          <span>At</span>
          <span className="threshold-at">
            <TextField value={th.at} preview={false} placeholder={placeholder} onChange={(v) => set((l) => (l.thresholds[i].at = v))} />
          </span>
          {unitLabel && <span className="muted small">{unitLabel}</span>}
          <ColorField value={th.color} onChange={(v) => set((l) => (l.thresholds[i].color = v))} />
          <button className="icon danger" title="Remove threshold" onClick={() => set((l) => l.thresholds.splice(i, 1))}>✕</button>
        </div>
      ))}
      <button className="link" onClick={add}>+ Threshold</button>
    </Section>
  );
}
