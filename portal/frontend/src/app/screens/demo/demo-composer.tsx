'use client';

import { useState } from 'react';
import { PageTitle } from '@/components/page-title';
import { DEMO_COMPANY_CONFIG } from '@/lib/demo-data';
import { PLATFORM_NAMES } from './demo-shared';

export function DemoComposer({
  company,
  onSave,
  onSubmit,
}: {
  company: string;
  onSave: (title: string, company: string) => void;
  onSubmit: (title: string, company: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [selectedCompany, setSelectedCompany] = useState(
    company === 'All companies' ? DEMO_COMPANY_CONFIG[0].name : company,
  );
  const [captions, setCaptions] = useState<Record<string, string>>({ Instagram: '' });
  const [platforms, setPlatforms] = useState<string[]>(['Instagram']);
  const [mediaName, setMediaName] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('Instagram');
  const limit = selectedPlatform === 'X' ? 280 : selectedPlatform === 'Instagram' ? 2200 : 3000;
  const caption = captions[selectedPlatform] ?? '';
  const togglePlatform = (name: string) =>
    setPlatforms((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  const save = () => {
    if (!title.trim()) return;
    onSave(title.trim(), selectedCompany);
    setTitle('');
    setCaptions({ Instagram: '' });
  };
  return (
    <>
      <PageTitle
        title="Create content"
        description="Draft once, tailor each channel, and send it through the DCC review path."
        action={<span className="status status-blue">Approval required before publishing</span>}
      />
      <div className="composer-layout">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Post details</h2>
              <p>Only sample content is saved in this browser preview.</p>
            </div>
            <span className="status status-gray">Draft</span>
          </div>
          <div className="grid grid-2">
            <div className="field-group">
              <label className="label" htmlFor="post-title">
                Internal title or campaign
              </label>
              <input
                className="field"
                id="post-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Community update"
              />
            </div>
            <div className="field-group">
              <label className="label" htmlFor="post-company">
                Company workspace
              </label>
              <select
                className="select-field"
                id="post-company"
                value={selectedCompany}
                onChange={(event) => setSelectedCompany(event.target.value)}
              >
                {(company === 'All companies'
                  ? DEMO_COMPANY_CONFIG.map((item) => item.name)
                  : [company]
                ).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-group">
            <span className="label">Publish to</span>
            <div className="platform-list">
              {PLATFORM_NAMES.map((name) => (
                <label className="platform-option" key={name}>
                  <input
                    type="checkbox"
                    checked={platforms.includes(name)}
                    onChange={() => togglePlatform(name)}
                  />
                  {name}
                </label>
              ))}
            </div>
            <small className="hint">
              Select the company accounts for each channel in a connected production workflow.
            </small>
          </div>
          <div className="field-group">
            <label className="label" htmlFor="caption">
              {selectedPlatform} caption
            </label>
            <textarea
              className="textarea-field"
              id="caption"
              value={caption}
              maxLength={limit}
              onChange={(event) =>
                setCaptions((current) => ({ ...current, [selectedPlatform]: event.target.value }))
              }
              placeholder={`Write a clear message for ${selectedPlatform}…`}
            />
            <small className="hint">
              {caption.length} / {limit} characters · Separate caption draft for the selected
              channel.
            </small>
          </div>
          <div className="field-group">
            <span className="label">Media</span>
            <label className="upload-zone">
              <span>
                {mediaName ? `Selected: ${mediaName}` : 'Add an image or video to your draft'}
                <small className="hint">
                  This preview reads the filename only. The file is not uploaded.
                </small>
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(event) => setMediaName(event.target.files?.[0]?.name ?? '')}
                />
              </span>
            </label>
          </div>
          <div className="grid grid-2">
            <div className="field-group">
              <label className="label" htmlFor="hashtags">
                Hashtags
              </label>
              <input id="hashtags" className="field" placeholder="#Coffee #Community" />
            </div>
            <div className="field-group">
              <label className="label" htmlFor="post-link">
                Link
              </label>
              <input
                id="post-link"
                className="field"
                type="url"
                placeholder="https://example.com"
              />
            </div>
          </div>
          <div className="heading-actions">
            <button className="btn btn-outline" onClick={save} disabled={!title.trim()}>
              Save draft
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!title.trim()) return;
                onSubmit(title.trim(), selectedCompany);
                setTitle('');
                setCaptions({ Instagram: '' });
              }}
              disabled={!title.trim() || platforms.length === 0}
            >
              Submit for review
            </button>
          </div>
          <small className="hint" style={{ marginTop: 12 }}>
            A creator cannot approve their own content. Review and publication are separate steps.
          </small>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Channel preview</h2>
              <p>Check your message before it enters review.</p>
            </div>
            <select
              aria-label="Preview channel"
              className="select-field"
              style={{ width: 130, padding: 7 }}
              value={selectedPlatform}
              onChange={(event) => setSelectedPlatform(event.target.value)}
            >
              {platforms.map((platform) => (
                <option key={platform}>{platform}</option>
              ))}
            </select>
          </div>
          <div className="preview-card">
            <div className="preview-head">
              <div className="preview-avatar">K</div>
              <div>
                <strong>
                  {company === 'All companies' ? DEMO_COMPANY_CONFIG[0].name : company}
                </strong>
                <small>{selectedPlatform} · Sample placeholder, not a connected account</small>
              </div>
            </div>
            <div className="preview-image">
              {mediaName ? `Media selected: ${mediaName}` : 'Media preview area'}
            </div>
            <div className="preview-body">
              {caption || 'Your caption preview will appear here as you write.'}
            </div>
            <div className="preview-actions">
              <span>♡ Like</span>
              <span>◯ Comment</span>
              <span>↗ Share</span>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 15, background: '#f8fbfc' }}>
            <strong style={{ fontSize: 12 }}>Review path</strong>
            <p style={{ margin: '6px 0 0', color: '#718091', fontSize: 11, lineHeight: 1.55 }}>
              Creator submits → assigned reviewer checks → approved content can be scheduled by an
              authorized publisher.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
