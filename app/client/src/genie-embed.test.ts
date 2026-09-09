import { describe, expect, it } from 'vitest';

import type { SettingsPayload } from './connection-model';
import { dataGenieSpaceId, genieEmbedUrl, genieRoomUrl } from './genie-embed';

/** A settings payload carrying just the checks these functions read. */
function settings(checks: Array<{ id: string; kind: string; name: string }>): SettingsPayload {
  return { checks: checks.map((check) => ({ ...check, status: 'ok' })) } as unknown as SettingsPayload;
}

const HOST = 'https://example.cloud.databricks.com';

describe('the Genie space the tab embeds', () => {
  it('is the data space, not the dictionary space, when both are reported', () => {
    const payload = settings([
      { id: 'genie-dictionary', kind: 'genie-space', name: 'dict-space' },
      { id: 'genie-data', kind: 'genie-space', name: 'data-space' },
    ]);
    expect(dataGenieSpaceId(payload)).toBe('data-space');
  });

  it('falls back to whichever Genie space did report when the data id is absent', () => {
    const payload = settings([{ id: 'genie-other', kind: 'genie-space', name: 'only-space' }]);
    expect(dataGenieSpaceId(payload)).toBe('only-space');
  });

  it('is empty when the checks have not landed or carry no Genie space', () => {
    expect(dataGenieSpaceId(null)).toBe('');
    expect(dataGenieSpaceId(settings([{ id: 'sql-warehouse', kind: 'sql-warehouse', name: 'wh' }]))).toBe('');
  });
});

describe('the embed URL the iframe points at', () => {
  it('is the room EMBED surface -- /embed/genie/rooms -- which the framing policy allows', () => {
    const payload = settings([{ id: 'genie-data', kind: 'genie-space', name: 'data-space' }]);
    expect(genieEmbedUrl(HOST, payload)).toBe(`${HOST}/embed/genie/rooms/data-space`);
  });

  it('normalizes a bare host into a scheme, since DATABRICKS_HOST is written both ways', () => {
    const payload = settings([{ id: 'genie-data', kind: 'genie-space', name: 'data-space' }]);
    expect(genieEmbedUrl('example.cloud.databricks.com', payload)).toBe(
      'https://example.cloud.databricks.com/embed/genie/rooms/data-space'
    );
  });

  it('is empty with no host or no Genie space, so the iframe gets no guessed src', () => {
    const payload = settings([{ id: 'genie-data', kind: 'genie-space', name: 'data-space' }]);
    expect(genieEmbedUrl('', payload)).toBe('');
    expect(genieEmbedUrl(HOST, null)).toBe('');
  });
});

describe('the room URL the "Open in Databricks" link points at', () => {
  it('is the full interactive room page, not the embed surface', () => {
    const payload = settings([{ id: 'genie-data', kind: 'genie-space', name: 'data-space' }]);
    expect(genieRoomUrl(HOST, payload)).toBe(`${HOST}/genie/rooms/data-space`);
  });

  it('is empty when there is no host or no Genie space', () => {
    const payload = settings([{ id: 'genie-data', kind: 'genie-space', name: 'data-space' }]);
    expect(genieRoomUrl('', payload)).toBe('');
    expect(genieRoomUrl(HOST, null)).toBe('');
  });
});
