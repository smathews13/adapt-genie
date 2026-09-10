import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuntimeGuidanceField, RuntimeSettingsPanel } from './RuntimeSettingsPanel';

const source = fs.readFileSync(path.join(__dirname, 'RuntimeSettingsPanel.tsx'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, 'SettingsPage.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, 'styles', 'settings.css'), 'utf8');
const responsiveStyles = fs.readFileSync(path.join(__dirname, 'styles', 'responsive-settings.css'), 'utf8');
const answerStyles = fs.readFileSync(path.join(__dirname, 'styles', 'answer.css'), 'utf8');

/**
 * The file with its commentary taken out.
 *
 * Needed by exactly one assertion below: the note this modal used to draw is
 * quoted verbatim in the comment that records its removal, so a test asserting
 * the sentence is absent from the source finds it in the explanation of why it is
 * absent. The quote is worth keeping -- it is the only record of what the line
 * said -- so the assertion reads the markup instead.
 */
const markupOf = (file: string): string =>
  file
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('runtime and appearance modal sections', () => {
  it('mounts both sections behind one modal settings form', () => {
    // Handed `onSaveState` as well, so the footer can say what Save did.
    expect(page).toContain('<RuntimeSettingsPanel');
    expect(page).toContain('section={active}');
    expect(page).toContain('onSaveState={setSaveState}');
    expect(page).toContain('onDirtyChange={handlePaneDirty}');
    expect(source).toContain("section: 'runtime' | 'appearance'");
    expect(source).toContain("export const RUNTIME_SETTINGS_FORM_ID = 'settings-runtime-form'");
  });

  it('writes through the admin route and preserves real errors and load retry', () => {
    expect(source).toContain("fetch('/api/admin/runtime-settings'");
    expect(source).toContain("runtimeSettingsDocumentFromResponse(response, 'loaded')");
    expect(source).toContain("runtimeSettingsDocumentFromResponse(response, 'saved')");
    expect(source).toContain("failure?.operation === 'load'");
    expect(source).toContain('failure.message');
  });

  it('keeps timezone on Appearance and drops the retired loop controls', () => {
    expect(source).not.toContain('Max analysis steps');
    expect(source).not.toContain('Max tool calls');
    expect(source).not.toContain('Run budget (s)');
    expect(source).not.toContain('Loop structure');
    expect(source).not.toContain('Takeaway');
    expect(source).not.toContain('id="answer-contract-settings"');
    expect(source).toContain('<RuntimeTimezoneField');
    expect(source).toContain('value={settings.behavior.timezone}');
    expect(source).not.toContain('placeholder="America/New_York"');
    const markup = renderToStaticMarkup(<RuntimeSettingsPanel section="appearance" />);
    expect(markup).toContain('<h3>Appearance</h3>');
    expect(markup).not.toContain('Loop structure');
  });

  it('does not offer answer-contract controls on Appearance', () => {
    const markup = renderToStaticMarkup(<RuntimeSettingsPanel section="appearance" />);
    expect(markup).not.toContain('Takeaway');
    expect(markup).not.toContain('Narrative cap');
    expect(source).not.toContain('id="answer-contract-settings"');
    expect(source).not.toContain('takeawayGuidance');
  });

  it('keeps example copy as placeholder text while rendering saved guidance as the value', () => {
    const placeholder = 'Example: a concise finding.';
    const empty = renderToStaticMarkup(<RuntimeGuidanceField value="" update={() => {}} placeholder={placeholder} />);
    const saved = renderToStaticMarkup(
      <RuntimeGuidanceField value="Use the saved customer tone." update={() => {}} placeholder={placeholder} />
    );

    expect(empty).toContain(`placeholder="${placeholder}"`);
    expect(empty.replace(`placeholder="${placeholder}"`, '')).not.toContain(placeholder);
    expect(saved).toContain('>Use the saved customer tone.</textarea>');
    expect(saved.replace(`placeholder="${placeholder}"`, '')).not.toContain(placeholder);
    expect(source).not.toContain('Example: {placeholder}');
    expect(source).not.toContain('runtime-control-example');
  });

  it('stacks the compact cap below Guidance on narrow screens without widening it', () => {
    expect(responsiveStyles).toMatch(
      /@media \(max-width:\s*800px\) \{[\s\S]*?\.runtime-answer-body--narrative \{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*\}[\s\S]*?\.runtime-answer-body--narrative \.runtime-answer-cap \{[^}]*width:\s*90px[^}]*justify-self:\s*start[^}]*\}/
    );
  });

  it('does not draw Loop structure on Appearance', () => {
    expect(source).not.toContain('runtime-loop-label--agent');
    expect(source).not.toContain('RuntimeLoopDiagram');
  });

  it('does not repeat the Runtime select field labels inside their triggers', () => {
    expect(source).not.toContain('showLabel=');
    expect(fs.readFileSync(path.join(__dirname, 'AppSelect.tsx'), 'utf8')).not.toContain('app-select-label');
    expect(source).toContain("label: 'DM Sans'");
    expect(source).toContain("label: 'System'");
    expect(source).toContain("label: 'DM Mono'");
  });

  it('renders the six live entity samples from the same settings saved to the server', () => {
    for (const kind of ['catalog', 'schema', 'table', 'column', 'quote', 'tag']) {
      expect(source).toContain(`${kind}:`);
    }
    expect(source).toContain('appearance-grid');
    expect(source).toContain('appearance-sample');
    expect(source).toContain('entityStyles');
    expect(source).toContain('colorScheme');
    expect(source).toContain('aria-label="Dark mode"');
    expect(source).not.toContain('previewColorScheme(on)');
    expect(source).toContain('appearance-sample-plaque');
    expect(source).toContain('fontBodyColor');
    expect(source).toContain('fontMutedColor');
    expect(source).toContain('fontFamily');
    expect(source).toContain('fontSize');
    expect(source).not.toContain('previewRuntimeTypography(settings)');
    expect(source).toContain('appearance-display-preview');
  });

  it('ends Display after the polished-by-default table treatment', () => {
    const markup = renderToStaticMarkup(<RuntimeSettingsPanel section="appearance" />);
    const display = markup.slice(markup.indexOf('appearance-display-section'), markup.indexOf('appearance-text-panel'));

    expect(markup).not.toContain('appearance-theme-section');
    expect(markup).not.toMatch(/<h4[^>]*>Theme<\/h4>/);
    expect(markup).not.toContain('appearance-interface-section');
    expect(markup).not.toMatch(/<h4[^>]*>Interface<\/h4>/);
    expect(display).toContain('<h4 class="runtime-section-label">Display</h4>');
    expect(display).toContain('appearance-display-rows');
    expect(display).toContain('Dark mode');
    expect(display).toContain('Experimental');
    expect(display).toContain('aria-label="Dark mode"');
    expect(display).toContain('>Animations</span>');
    expect(display).toContain('Density');
    expect(display.lastIndexOf('experimental-pane-badge', display.indexOf('Dark mode'))).toBeLessThan(
      display.indexOf('Dark mode')
    );
    expect(display.lastIndexOf('experimental-pane-badge', display.indexOf('Density'))).toBeLessThan(
      display.indexOf('Density')
    );
    expect(display).not.toContain('>Body text</span>');
    expect(display).not.toContain('>Secondary</span>');
    expect(display).toContain('>Tables</span>');
    expect(display).toMatch(/aria-checked="true"[^>]*>Polished<\/button>/);
    const labels = ['Dark mode', 'Animations', 'Density', 'Tables'];
    for (let index = 1; index < labels.length; index += 1) {
      expect(display.indexOf(labels[index - 1])).toBeLessThan(display.indexOf(labels[index]));
    }
    expect(display).not.toContain('>Font</span>');
    expect(display).not.toContain('>Size</span>');
  });

  it('keeps text controls and preview in one compact group without a Typography section', () => {
    const markup = renderToStaticMarkup(<RuntimeSettingsPanel section="appearance" />);
    const text = markup.slice(markup.indexOf('appearance-text-panel'), markup.indexOf('appearance-palette-section'));

    expect(text).toContain('role="group" aria-label="Text"');
    expect(text).toContain('aria-label="Body text color picker"');
    expect(text).toContain('aria-label="Body text color"');
    expect(text).toContain('aria-label="Secondary text color picker"');
    expect(text).toContain('aria-label="Secondary text color"');
    expect(text).toContain('aria-label="Font: DM Sans"');
    expect(text).toContain('role="radiogroup"');
    expect(text).toContain('aria-label="Font size L"');
    expect(text).toContain('appearance-display-preview');
    expect(markup).not.toContain(['appearance', 'typography', 'section'].join('-'));
    expect(markup).not.toMatch(/<h4[^>]*>Typography<\/h4>/);
    expect(source).toContain('data-color-scheme={settings.colorScheme}');
    expect(source).toContain("'--appearance-preview-body': settings.fontBodyColor");
    expect(source).toContain("'--appearance-preview-font': FONT_FAMILY_STACKS[settings.fontFamily]");
  });

  it('lays out the consolidated text panel across supported responsive breakpoints', () => {
    expect(styles).toMatch(/\.appearance-text-panel\s*\{[^}]*display:\s*grid[^}]*border:\s*1px solid/s);
    expect(styles).toMatch(
      /\.appearance-text-controls\s*\{[^}]*grid-template-columns:\s*minmax\(190px,\s*1\.35fr\)\s*auto\s*repeat\(2,\s*minmax\(150px,\s*1fr\)\)/
    );
    expect(responsiveStyles).toMatch(
      /@media \(max-width:\s*800px\)\s*\{[\s\S]*?\.appearance-text-controls\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
    );
    expect(responsiveStyles).toMatch(
      /@media \(max-width:\s*480px\)\s*\{[\s\S]*?\.appearance-text-controls\s*\{[^}]*minmax\(0,\s*1fr\)/
    );
    expect(styles).toContain(".appearance-display-preview[data-color-scheme='dark']");
    expect(styles).toContain(".appearance-display-preview[data-color-scheme='light']");
  });

  it('pairs Body text and Secondary hex fields with a native colour picker', () => {
    expect(source).toContain('type="color"');
    expect(source).toContain('appearance-color-picker');
    expect(source).toContain("isHexColor(hex) ? hex : '#000000'");
    expect(source).toContain('`${aria} picker`');
    expect(styles).toContain('.appearance-color-picker');
    expect(styles).toContain("input:not([type='color'])");
  });

  it('pairs every entity text and highlight hex field with the same native picker', () => {
    const entityColors = source.slice(source.indexOf('aria-label="Answer entity colors"'));
    expect(entityColors).toContain('type="color"');
    expect(entityColors).toContain('aria-label={`${kind} ${property} picker`}');
    expect(entityColors).toContain("isHexColor(hex) ? hex : '#000000'");
    expect(entityColors).not.toContain('appearance-color-swatch" aria-hidden="true"');
  });

  it('stages appearance edits and applies them only after a save succeeds', () => {
    expect(source).not.toContain('Theme, type, and chip colours. They apply across Ask, Run Explorer, and Monitoring.');
    expect(source).not.toContain('Limits how many reasoning passes');
    expect(source).toContain('2026-07-22 – 2026-08-03');
    expect(source).toContain('Rockstar, 2K');
    expect(source).toContain('adoptRuntimeEntityStyles(saved.settings)');
    expect(source).not.toContain('previewColorScheme(on)');
    expect(source).not.toContain('previewRuntimeTypography(settings)');
    expect(styles).toMatch(/\.appearance-sample-plaque\s*\{[^}]*background:\s*var\(--background\)/);
    expect(answerStyles).toMatch(/\.answer-badge--date\s*\{[^}]*--ast-entity-quote-fg[^}]*--ast-entity-quote-bg/);
    expect(answerStyles).toMatch(/\.answer-badge--tag\s*\{[^}]*--ast-entity-tag-fg[^}]*--ast-entity-tag-bg/);
  });

  it('keeps one footer Save, in the shell rather than in the pane', () => {
    /*
     * The two attributes, not their adjacency. This wanted them on consecutive
     * lines and so broke when the button gained a styling attribute between them,
     * reporting a formatting change as a missing Save button. What matters is that
     * the shell's footer button submits, and submits the open pane's own form.
     */
    const save = /<Button\b[^>]*\btype=\{experimentalSaveOnly \? 'button' : 'submit'\}[^>]*>/s.exec(page)?.[0] ?? '';
    expect(save).toContain("type={experimentalSaveOnly ? 'button' : 'submit'}");
    expect(save).toContain('form={experimentalSaveOnly ? undefined : form}');
    expect(source).not.toContain('Save runtime settings');
  });

  it('carries no safeguards note, on any pane or in any state', () => {
    // The Runtime pane used to draw a locked line in the footer: "Dictionary-first
    // field binding and never-invent-figures are mandatory safeguards, not
    // switches." Removed at Sam's request, and asserted three ways because there
    // are three ways for it to come back -- the sentence, the element that held it,
    // and the rule that painted it.
    const markup = markupOf(page);
    expect(markup).not.toContain('mandatory safeguards');
    expect(markup).not.toContain('settings-footer-note');
    expect(styles).not.toContain('.settings-footer-note');
    expect(styles).toMatch(/\.settings-modal-footer \{[^}]*justify-content:\s*space-between/);
  });

  it('presses Save and keeps the modal open after the save lands', () => {
    expect(page).toContain("data-pressed={pressed ? 'true' : undefined}");
    expect(page).toContain('setPressed(true)');
    expect(styles).toMatch(/\[data-pressed='true'\] \{[^}]*background:\s*var\(--db-blue-800\)/);
    expect(page).not.toContain('saveLanded(saveState)');
    expect(page).not.toMatch(/setTimeout\(\(\) => close\(\), SAVE_PRESS_MS\)/);
    expect(page).toContain('unsavedChangesLabel(dirtyCount)');
  });
});
