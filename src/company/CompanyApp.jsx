import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons';
import {
  UNIT_COLORS,
  addNode,
  brandList,
  buildIndex,
  countPeople,
  dutyLines,
  emptyNode,
  formatPhone,
  getAncestors,
  getDescendantIds,
  initials,
  inkOn,
  matchesQuery,
  moveSibling,
  normalizeDoc,
  PHOTO_MAX_LENGTH,
  phoneHref,
  removeNode,
  resolveColor,
  siblingPosition,
  telegramHandle,
  updateNode,
} from './model';
import { fetchRemote, isApprovedCompanyAdmin, isRemoteEnabled, readCache, saveDoc, seedDoc, writeCache } from './storage';
import { loadStoredUser, USER_STORAGE_KEY } from '../lib/shopSession';
import { copyToClipboard } from '../lib/clipboard';

const VIEW_KEY = 'company-structure:view';
const HISTORY_LIMIT = 40;

function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

// telegram-web-app.js also loads in a normal browser, where it reports
// platform "unknown" and a hard-coded light colour scheme.
function telegramApp() {
  const tg = window.Telegram?.WebApp;
  return tg && (tg.initData || (tg.platform && tg.platform !== 'unknown')) ? tg : null;
}

const THEME_COLORS = { light: '#eef5fb', dark: '#0d1520' };

function useTheme() {
  useEffect(() => {
    const tg = telegramApp();
    const apply = () => {
      const scheme = tg?.colorScheme
        || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = scheme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[scheme] || THEME_COLORS.light);
    };
    apply();
    tg?.onEvent?.('themeChanged', apply);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', apply);
    return () => {
      tg?.offEvent?.('themeChanged', apply);
      media?.removeEventListener?.('change', apply);
    };
  }, []);
}

function openTelegram(handle) {
  const link = `https://t.me/${handle}`;
  const tg = window.Telegram?.WebApp;
  try {
    if (tg?.openTelegramLink && tg.platform && tg.platform !== 'unknown') {
      tg.openTelegramLink(link);
      return;
    }
  } catch {
    // fall back to a new tab
  }
  window.open(link, '_blank', 'noopener');
}

function haptic(type = 'light') {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(type);
  } catch {
    // ignore
  }
}

// ─── Small building blocks ──────────────────────────────────

// Unit colour plus a text colour that stays readable on top of it.
function tone(color) {
  return { '--c': color, '--ink': inkOn(color) };
}

function Avatar({ node, color, size = 40 }) {
  const label = node.type === 'unit' ? null : initials(node.name);
  return (
    <span
      className={`co-avatar ${node.type === 'unit' ? 'is-unit' : ''} ${node.photo ? 'has-photo' : ''}`}
      style={{ ...tone(color), width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {node.photo && node.type !== 'unit'
        ? <img src={node.photo} alt="" loading="lazy" draggable="false" />
        : label || <Icon name={node.type === 'unit' ? 'users' : 'briefcase'} size={size * 0.48} />}
    </span>
  );
}

function IconButton({ icon, label, onClick, active, className = '', disabled, size = 18 }) {
  return (
    <button
      type="button"
      className={`co-icon-btn ${active ? 'is-active' : ''} ${className}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]), textarea:not([disabled])';

// Modal behaviour shared by sheets and dialogs: Escape closes the top-most
// layer only, Tab stays inside it, and focus returns to the opener on close.
function useModal(open, onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const el = ref.current;
    const opener = document.activeElement;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });

    const onKey = (event) => {
      const layers = document.querySelectorAll('[data-co-modal]');
      if (!el || layers[layers.length - 1] !== el) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter((item) => item.offsetParent !== null);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !el.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !el.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus?.({ preventScroll: true });
    };
  }, [open]);

  return ref;
}

function Sheet({ open, onClose, title, children, wide, footer }) {
  const ref = useModal(open, onClose);

  if (!open) return null;
  return (
    <div className="co-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`co-sheet ${wide ? 'is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-co-modal
      >
        <div className="co-sheet-grip" />
        <div className="co-sheet-head">
          <h2>{title}</h2>
          <IconButton icon="close" label="Закрити" onClick={onClose} />
        </div>
        <div className="co-sheet-body">{children}</div>
        {footer ? <div className="co-sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

function Dialog({ onClose, title, children }) {
  const ref = useModal(true, onClose);
  return (
    <div className="co-overlay is-center" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={ref} className="co-dialog" role="alertdialog" aria-modal="true" aria-label={title} tabIndex={-1} data-co-modal>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

// ─── Tree (org chart) view ──────────────────────────────────

function OrgCard({ node, ctx, compact }) {
  const { doc, index, editMode, onOpen, onAdd, onEdit } = ctx;
  const color = resolveColor(doc, node.id);
  const isRoot = !node.parentId;
  const kids = index.children.get(node.id) || [];
  const people = node.type === 'unit' ? countPeople(doc, node.id) : kids.length;
  const highlight = ctx.highlightId === node.id;

  return (
    <div
      className={[
        'co-card',
        node.type === 'unit' ? 'is-unit' : 'is-person',
        isRoot ? 'is-root' : '',
        compact ? 'is-compact' : '',
        highlight ? 'is-highlight' : '',
      ].join(' ')}
      style={tone(color)}
      data-node-id={node.id}
    >
      <button type="button" className="co-card-main" onClick={() => onOpen(node.id)}>
        {node.type === 'unit' ? (
          <>
            <span className="co-unit-icon"><Icon name="users" size={16} /></span>
            <span className="co-card-text">
              <span className="co-card-name">{node.title || 'Без назви'}</span>
              <span className="co-card-title">{people} {pluralPeople(people)}</span>
            </span>
          </>
        ) : (
          <>
            <Avatar node={node} color={color} size={isRoot ? 48 : compact ? 34 : 40} />
            <span className="co-card-text">
              <span className="co-card-name">{node.name || 'Вакансія'}</span>
              <span className="co-card-title">{node.title || '—'}</span>
              {!compact && node.brands ? <span className="co-card-brands">{node.brands}</span> : null}
            </span>
          </>
        )}
      </button>
      {editMode ? (
        <div className="co-card-actions">
          <IconButton icon="plus" label="Додати підлеглого" size={14} onClick={() => onAdd(node.id)} />
          <IconButton icon="edit" label="Редагувати" size={14} onClick={() => onEdit(node.id)} />
        </div>
      ) : null}
    </div>
  );
}

function pluralPeople(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'людина';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'людини';
  return 'людей';
}

function OrgBranch({ node, ctx }) {
  const kids = ctx.index.children.get(node.id) || [];
  const isLeaf = (child) => !(ctx.index.children.get(child.id) || []).length;

  if (!kids.length) {
    return (
      <div className="co-branch">
        <OrgCard node={node} ctx={ctx} />
      </div>
    );
  }

  // Only leaves below: stack them vertically to keep the chart narrow.
  if (kids.every(isLeaf) && node.parentId) {
    return (
      <div className="co-branch">
        <OrgCard node={node} ctx={ctx} />
        <div className="co-stack" style={tone(resolveColor(ctx.doc, node.id))}>
          {kids.map((kid) => (
            <div className="co-stack-item" key={kid.id}>
              <OrgCard node={kid} ctx={ctx} compact />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Mixed children: consecutive leaves share one column.
  const groups = [];
  for (const kid of kids) {
    const last = groups[groups.length - 1];
    if (isLeaf(kid) && last?.leaves) last.items.push(kid);
    else groups.push(isLeaf(kid) ? { leaves: true, items: [kid] } : { leaves: false, items: [kid] });
  }

  return (
    <div className="co-branch">
      <OrgCard node={node} ctx={ctx} />
      <div className="co-row">
        {groups.map((group) => (
          <div className="co-col" key={group.items[0].id}>
            {group.leaves ? (
              <div className="co-leaf-group">
                {group.items.map((item) => (
                  <OrgCard key={item.id} node={item} ctx={ctx} />
                ))}
              </div>
            ) : (
              <OrgBranch node={group.items[0]} ctx={ctx} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// The displayed 100% is 85% of the original canvas size.
const ZOOM_BASE_SCALE = 0.85;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 1.6;

function TreeView({ ctx, focusId }) {
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const drag = useRef(null);
  const pinch = useRef(null);

  const clampZoom = (value) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));

  const zoomAround = useCallback((nextZoom, clientX, clientY) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setZoom((current) => {
      const target = clampZoom(nextZoom(current));
      if (target === current) return current;
      const rect = viewport.getBoundingClientRect();
      const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
      const py = (clientY ?? rect.top + rect.height / 2) - rect.top;
      const contentX = (viewport.scrollLeft + px) / current;
      const contentY = (viewport.scrollTop + py) / current;
      requestAnimationFrame(() => {
        viewport.scrollLeft = contentX * target - px;
        viewport.scrollTop = contentY * target - py;
      });
      return target;
    });
  }, []);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    const width = canvas.scrollWidth;
    const height = canvas.scrollHeight;
    const fittedScale = Math.min((viewport.clientWidth - 24) / width, (viewport.clientHeight - 24) / height);
    const next = clampZoom(Math.min(fittedScale / ZOOM_BASE_SCALE, 1));
    setZoom(next);
    requestAnimationFrame(() => {
      viewport.scrollLeft = (width * next * ZOOM_BASE_SCALE - viewport.clientWidth) / 2;
      viewport.scrollTop = 0;
    });
  }, []);

  // Start centred on the root card.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    requestAnimationFrame(() => {
      viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    });
  }, []);

  // Scroll a searched/selected node into view.
  useEffect(() => {
    if (!focusId) return;
    const viewport = viewportRef.current;
    const card = viewport?.querySelector(`[data-node-id="${CSS.escape(focusId)}"]`);
    if (!card) return;
    const vr = viewport.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    viewport.scrollTo({
      left: viewport.scrollLeft + cr.left - vr.left - vr.width / 2 + cr.width / 2,
      top: viewport.scrollTop + cr.top - vr.top - vr.height / 3,
      behavior: 'smooth',
    });
  }, [focusId]);

  // Ctrl/⌘ + wheel or trackpad pinch zooms; plain wheel scrolls.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.01);
      zoomAround((z) => z * factor, event.clientX, event.clientY);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  // Two-finger pinch on touch screens.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const distance = (touches) => Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY
    );
    const onStart = (event) => {
      if (event.touches.length === 2) pinch.current = { d: distance(event.touches) };
    };
    const onMove = (event) => {
      if (event.touches.length !== 2 || !pinch.current) return;
      event.preventDefault();
      const d = distance(event.touches);
      const ratio = d / pinch.current.d;
      pinch.current.d = d;
      const cx = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const cy = (event.touches[0].clientY + event.touches[1].clientY) / 2;
      zoomAround((z) => z * ratio, cx, cy);
    };
    const onEnd = () => {
      pinch.current = null;
    };
    viewport.addEventListener('touchstart', onStart, { passive: true });
    viewport.addEventListener('touchmove', onMove, { passive: false });
    viewport.addEventListener('touchend', onEnd);
    return () => {
      viewport.removeEventListener('touchstart', onStart);
      viewport.removeEventListener('touchmove', onMove);
      viewport.removeEventListener('touchend', onEnd);
    };
  }, [zoomAround]);

  // Mouse drag pans the canvas (touch already scrolls natively).
  const onPointerDown = (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if (event.target.closest('button, a, input')) return;
    const viewport = viewportRef.current;
    drag.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-dragging');
  };
  const onPointerMove = (event) => {
    if (!drag.current) return;
    const viewport = viewportRef.current;
    viewport.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    viewport.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };
  const onPointerUp = () => {
    drag.current = null;
    viewportRef.current?.classList.remove('is-dragging');
  };

  const root = ctx.index.root;

  return (
    <div className="co-tree-wrap">
      <div
        className="co-tree-viewport"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="co-tree-canvas" ref={canvasRef} style={{ zoom: zoom * ZOOM_BASE_SCALE }}>
          {root ? <OrgBranch node={root} ctx={ctx} /> : null}
        </div>
      </div>
      <div className="co-zoom" role="group" aria-label="Масштаб">
        <IconButton icon="zoomOut" label="Зменшити" onClick={() => zoomAround((z) => z - 0.15)} />
        <button type="button" className="co-zoom-value" onClick={() => setZoom(1)} title="Скинути до 100%" aria-label={`Масштаб ${Math.round(zoom * 100)}%. Скинути до 100%`}>
          {Math.round(zoom * 100)}%
        </button>
        <IconButton icon="zoomIn" label="Збільшити" onClick={() => zoomAround((z) => z + 0.15)} />
        <IconButton icon="fit" label="Вмістити все" onClick={fit} />
      </div>
    </div>
  );
}

// ─── List view (mobile friendly) ────────────────────────────

function ListNode({ node, ctx, depth }) {
  const kids = ctx.index.children.get(node.id) || [];
  const collapsed = ctx.collapsed.has(node.id);
  const color = resolveColor(ctx.doc, node.id);
  const total = node.type === 'unit' ? countPeople(ctx.doc, node.id) : kids.length;

  return (
    <li className={`co-li ${node.type === 'unit' ? 'is-unit' : ''}`} style={tone(color)}>
      <div className={`co-li-row ${ctx.highlightId === node.id ? 'is-highlight' : ''}`} data-node-id={node.id}>
        {kids.length ? (
          <button
            type="button"
            className={`co-li-toggle ${collapsed ? '' : 'is-open'}`}
            onClick={() => ctx.toggle(node.id)}
            aria-label={collapsed ? 'Розгорнути' : 'Згорнути'}
            aria-expanded={!collapsed}
          >
            <Icon name="chevron" size={16} />
          </button>
        ) : (
          <span className="co-li-toggle is-empty" />
        )}
        <button type="button" className="co-li-main" onClick={() => ctx.onOpen(node.id)}>
          {node.type === 'unit' ? (
            <span className="co-unit-icon"><Icon name="users" size={16} /></span>
          ) : (
            <Avatar node={node} color={color} size={depth === 0 ? 44 : 38} />
          )}
          <span className="co-card-text">
            <span className="co-card-name">{node.type === 'unit' ? node.title : node.name || 'Вакансія'}</span>
            <span className="co-card-title">
              {node.type === 'unit' ? `${total} ${pluralPeople(total)}` : node.title}
            </span>
          </span>
          {node.type !== 'unit' && kids.length ? <span className="co-badge">{kids.length}</span> : null}
        </button>
        {ctx.editMode ? (
          <div className="co-li-actions">
            <IconButton icon="plus" label="Додати підлеглого" size={15} onClick={() => ctx.onAdd(node.id)} />
            <IconButton icon="edit" label="Редагувати" size={15} onClick={() => ctx.onEdit(node.id)} />
          </div>
        ) : null}
      </div>
      {kids.length && !collapsed ? (
        <ul className="co-ul">
          {kids.map((kid) => (
            <ListNode key={kid.id} node={kid} ctx={ctx} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ListView({ ctx }) {
  const root = ctx.index.root;
  return (
    <div className="co-list-wrap">
      <div className="co-list-tools">
        <button type="button" className="co-link-btn" onClick={ctx.expandAll}>Розгорнути все</button>
        <button type="button" className="co-link-btn" onClick={ctx.collapseAll}>Згорнути все</button>
      </div>
      <ul className="co-ul is-root">{root ? <ListNode node={root} ctx={ctx} depth={0} /> : null}</ul>
    </div>
  );
}

// ─── Search results ─────────────────────────────────────────

// Wraps the matched part of `text` in <mark>.
function Highlight({ text, query }) {
  const value = text || '';
  const at = query ? value.toLowerCase().indexOf(query) : -1;
  if (at < 0) return value;
  return (
    <>
      {value.slice(0, at)}
      <mark>{value.slice(at, at + query.length)}</mark>
      {value.slice(at + query.length)}
    </>
  );
}

const SNIPPET_FIELDS = [
  ['brands', 'Бренди'],
  ['duties', 'Питання'],
  ['telegram', 'Telegram'],
  ['email', 'Пошта'],
  ['phone', 'Телефон'],
];

// When the match is in a field the row does not show, quote it.
function matchSnippet(node, q) {
  if (`${node.name} ${node.title}`.toLowerCase().includes(q)) return null;
  for (const [field, label] of SNIPPET_FIELDS) {
    const line = String(node[field] || '').split('\n').find((l) => l.toLowerCase().includes(q));
    if (!line) continue;
    const at = line.toLowerCase().indexOf(q);
    const start = Math.max(0, at - 24);
    return { label, text: `${start ? '…' : ''}${line.slice(start, at + q.length + 48).trim()}` };
  }
  return null;
}

function pluralResults(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'результат';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'результати';
  return 'результатів';
}

function SearchResults({ doc, query, onOpen, onClear }) {
  const q = query.trim().toLowerCase();
  const results = doc.nodes.filter((node) => matchesQuery(node, query));
  if (!results.length) {
    return (
      <div className="co-empty">
        <span className="co-empty-icon"><Icon name="search" size={24} /></span>
        <p><strong>Нічого не знайдено</strong></p>
        <p>За запитом «{query.trim()}» немає збігів. Спробуйте ім'я, посаду або бренд.</p>
        <button type="button" className="co-btn" onClick={onClear}>Очистити пошук</button>
      </div>
    );
  }
  return (
    <div className="co-results">
      <p className="co-results-count" role="status">{results.length} {pluralResults(results.length)}</p>
      {results.map((node) => {
        const color = resolveColor(doc, node.id);
        const path = getAncestors(doc, node.id)
          .filter((a) => a.type === 'unit')
          .map((a) => a.title)
          .join(' › ');
        const snippet = matchSnippet(node, q);
        return (
          <button key={node.id} type="button" className="co-result" onClick={() => onOpen(node.id)} style={tone(color)}>
            <Avatar node={node} color={color} size={40} />
            <span className="co-card-text">
              <span className="co-card-name">
                <Highlight text={node.type === 'unit' ? node.title : node.name || 'Вакансія'} query={q} />
              </span>
              <span className="co-card-title">
                {node.type === 'unit' ? 'Підрозділ' : <Highlight text={node.title} query={q} />}
              </span>
              {snippet ? (
                <span className="co-card-brands">{snippet.label}: <Highlight text={snippet.text} query={q} /></span>
              ) : path ? <span className="co-card-brands">{path}</span> : null}
            </span>
            <Icon name="chevron" size={16} className="co-muted" />
          </button>
        );
      })}
    </div>
  );
}

// ─── Details sheet ──────────────────────────────────────────

function ContactRow({ icon, label, value, href, onClick, onCopy }) {
  if (!value) return null;
  const content = (
    <>
      <span className="co-contact-icon"><Icon name={icon} size={18} /></span>
      <span className="co-contact-text">
        <span className="co-contact-label">{label}</span>
        <span className="co-contact-value">{value}</span>
      </span>
    </>
  );
  return (
    <div className="co-contact">
      {onClick ? (
        <button type="button" className="co-contact-main" onClick={onClick}>{content}</button>
      ) : (
        <a className="co-contact-main" href={href}>{content}</a>
      )}
      <IconButton icon="copy" label={`Скопіювати: ${label}`} onClick={onCopy} />
    </div>
  );
}

function NodeDetails({ doc, nodeId, onOpen, onEdit, onAdd, onDelete, onMove, editMode, notify }) {
  const index = useMemo(() => buildIndex(doc), [doc]);
  const node = index.byId.get(nodeId);
  if (!node) return null;
  const color = resolveColor(doc, node.id);
  const ancestors = getAncestors(doc, node.id);
  const manager = [...ancestors].reverse().find((a) => a.type === 'person');
  const kids = index.children.get(node.id) || [];
  const handle = telegramHandle(node.telegram);
  const lines = dutyLines(node.duties);
  const brands = brandList(node.brands);
  const { index: pos, total } = siblingPosition(doc, node.id);

  const copy = async (value, what) => {
    try {
      await copyToClipboard(value);
      notify(`${what} скопійовано`);
    } catch {
      notify('Не вдалося скопіювати');
    }
  };

  return (
    <div className="co-details" style={tone(color)}>
      <div className="co-details-hero">
        <Avatar node={node} color={color} size={64} />
        <div>
          <div className="co-details-name">{node.type === 'unit' ? node.title : node.name || 'Вакансія'}</div>
          <div className="co-details-title">
            {node.type === 'unit' ? `Підрозділ · ${countPeople(doc, node.id)} ${pluralPeople(countPeople(doc, node.id))}` : node.title}
          </div>
          {ancestors.length ? (
            <div className="co-crumbs">
              {ancestors.map((a) => (
                <button key={a.id} type="button" onClick={() => onOpen(a.id)}>
                  {a.type === 'unit' ? a.title : a.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {brands.length ? (
        <div className="co-section">
          <div className="co-section-title">Бренди</div>
          <div className="co-chips">
            {brands.map((brand) => <span key={brand} className="co-chip">{brand}</span>)}
          </div>
        </div>
      ) : null}

      {node.type === 'person' && (handle || node.phone || node.email) ? (
        <div className="co-section">
          <div className="co-section-title">Контакти</div>
          <div className="co-contacts">
            <ContactRow
              icon="telegram"
              label="Telegram"
              value={handle ? `@${handle}` : ''}
              onClick={() => openTelegram(handle)}
              onCopy={() => copy(`@${handle}`, 'Telegram')}
            />
            <ContactRow
              icon="phone"
              label="Телефон"
              value={formatPhone(node.phone)}
              href={phoneHref(node.phone)}
              onCopy={() => copy(node.phone, 'Телефон')}
            />
            <ContactRow
              icon="mail"
              label="Пошта"
              value={node.email}
              href={`mailto:${node.email}`}
              onCopy={() => copy(node.email, 'Пошту')}
            />
          </div>
        </div>
      ) : null}

      {lines.length ? (
        <div className="co-section">
          <div className="co-section-title">З яких питань звертатись</div>
          <ul className="co-duties">
            {lines.map((line, i) => (
              <li key={i} className={line.heading ? 'is-heading' : ''}>{line.text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {manager && node.type === 'person' ? (
        <div className="co-section">
          <div className="co-section-title">Керівник</div>
          <PersonLink doc={doc} node={manager} onOpen={onOpen} />
        </div>
      ) : null}

      {kids.length ? (
        <div className="co-section">
          <div className="co-section-title">{node.type === 'unit' ? 'Склад' : 'Підлеглі'} · {kids.length}</div>
          <div className="co-people">
            {kids.map((kid) => <PersonLink key={kid.id} doc={doc} node={kid} onOpen={onOpen} />)}
          </div>
        </div>
      ) : null}

      {editMode ? (
        <div className="co-section co-edit-bar">
          <button type="button" className="co-btn is-primary" onClick={() => onEdit(node.id)}>
            <Icon name="edit" size={16} /> Редагувати
          </button>
          <button type="button" className="co-btn" onClick={() => onAdd(node.id)}>
            <Icon name="plus" size={16} /> Підлеглий
          </button>
          {node.parentId ? (
            <>
              <IconButton icon="up" label="Вище серед колег" disabled={pos <= 0} onClick={() => onMove(node.id, -1)} />
              <IconButton icon="down" label="Нижче серед колег" disabled={pos >= total - 1} onClick={() => onMove(node.id, 1)} />
            </>
          ) : null}
          <IconButton icon="trash" label="Видалити" className="is-danger" onClick={() => onDelete(node.id)} />
        </div>
      ) : null}
    </div>
  );
}

function PersonLink({ doc, node, onOpen }) {
  const color = resolveColor(doc, node.id);
  return (
    <button type="button" className="co-person-link" onClick={() => onOpen(node.id)} style={tone(color)}>
      <Avatar node={node} color={color} size={34} />
      <span className="co-card-text">
        <span className="co-card-name">{node.type === 'unit' ? node.title : node.name || 'Вакансія'}</span>
        <span className="co-card-title">{node.type === 'unit' ? 'Підрозділ' : node.title}</span>
      </span>
      <Icon name="chevron" size={16} className="co-muted" />
    </button>
  );
}

// ─── Edit form ──────────────────────────────────────────────

function parentOptions(doc, excludeId) {
  const index = buildIndex(doc);
  const exclude = excludeId ? getDescendantIds(doc, excludeId) : new Set();
  if (excludeId) exclude.add(excludeId);
  const result = [];
  const walk = (node, depth) => {
    if (exclude.has(node.id)) return;
    result.push({
      id: node.id,
      label: `${'— '.repeat(depth)}${node.type === 'unit' ? `▣ ${node.title}` : `${node.name || 'Вакансія'}${node.title ? ` · ${node.title}` : ''}`}`,
    });
    for (const kid of index.children.get(node.id) || []) walk(kid, depth + 1);
  };
  if (index.root) walk(index.root, 0);
  return result;
}

// Center-crops an image file to a small square JPEG data URL for the avatar.
async function fileToAvatar(file, size = 160) {
  if (!file?.type?.startsWith('image/')) throw new Error('Оберіть файл зображення.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Не вдалося прочитати зображення.'));
      image.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size);
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size
    );
    for (const quality of [0.85, 0.75, 0.6]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= PHOTO_MAX_LENGTH) return data;
    }
    throw new Error('Фото завелике.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function PhotoField({ form, setForm, color }) {
  const inputRef = useRef(null);
  const [error, setError] = useState('');
  const pick = async (file) => {
    setError('');
    try {
      const photo = await fileToAvatar(file);
      setForm((f) => ({ ...f, photo }));
    } catch (err) {
      setError(err.message || 'Не вдалося завантажити фото.');
    }
  };
  return (
    <div className="co-photo-field">
      <button type="button" className="co-photo-pick" onClick={() => inputRef.current?.click()} aria-label="Обрати фото">
        <Avatar node={form} color={color} size={72} />
        <span className="co-photo-badge"><Icon name="camera" size={14} /></span>
      </button>
      <div className="co-photo-actions">
        <button type="button" className="co-btn" onClick={() => inputRef.current?.click()}>
          <Icon name="upload" size={16} /> {form.photo ? 'Змінити фото' : 'Додати фото'}
        </button>
        {form.photo ? (
          <button type="button" className="co-link-btn is-danger" onClick={() => setForm((f) => ({ ...f, photo: '' }))}>
            Прибрати фото
          </button>
        ) : <span className="co-hint">Квадратна обрізка по центру, до 160×160</span>}
        {error ? <span className="co-hint is-error">{error}</span> : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) pick(file);
        }}
      />
    </div>
  );
}

function NodeForm({ doc, draft, isNew, onCancel, onSave }) {
  const [form, setForm] = useState(draft);
  const photoColor = resolveColor(doc, draft.parentId || draft.id);
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));
  const options = useMemo(() => parentOptions(doc, isNew ? null : draft.id), [doc, draft.id, isNew]);
  const isRoot = !isNew && !draft.parentId;
  const valid = form.type === 'unit' ? form.title.trim() : form.name.trim() || form.title.trim();

  const submit = (event) => {
    event.preventDefault();
    if (!valid) return;
    onSave({
      ...form,
      title: form.title.trim(),
      name: form.name.trim(),
      brands: form.brands.trim(),
      telegram: form.telegram.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      duties: form.duties.trim(),
    });
  };

  return (
    <form className="co-form" onSubmit={submit} id="co-node-form">
      <div className="co-segment" role="radiogroup" aria-label="Тип">
        {[['person', 'Співробітник', 'briefcase'], ['unit', 'Підрозділ / група', 'users']].map(([value, label, icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={form.type === value}
            className={form.type === value ? 'is-active' : ''}
            onClick={() => setForm((f) => ({ ...f, type: value }))}
          >
            <Icon name={icon} size={16} /> {label}
          </button>
        ))}
      </div>

      {!isRoot ? (
        <label className="co-field">
          <span>Підпорядковується</span>
          <select value={form.parentId || ''} onChange={set('parentId')}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      ) : null}

      {form.type === 'unit' ? (
        <>
          <label className="co-field">
            <span>Назва підрозділу *</span>
            <input value={form.title} onChange={set('title')} placeholder="Напр. Digital Unit" autoFocus />
          </label>
          <div className="co-field">
            <span>Колір</span>
            <div className="co-swatches">
              {UNIT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`co-swatch ${form.color === c ? 'is-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  aria-label={`Колір ${c}`}
                />
              ))}
            </div>
          </div>
          <label className="co-field">
            <span>Опис / з яких питань звертатись</span>
            <textarea rows={4} value={form.duties} onChange={set('duties')} placeholder="Кожен пункт з нового рядка" />
          </label>
        </>
      ) : (
        <>
          <PhotoField form={form} setForm={setForm} color={photoColor} />
          <div className="co-grid-2">
            <label className="co-field">
              <span>ПІБ *</span>
              <input value={form.name} onChange={set('name')} placeholder="Прізвище Ім'я" autoFocus />
            </label>
            <label className="co-field">
              <span>Посада</span>
              <input value={form.title} onChange={set('title')} placeholder="Напр. Brand Manager" />
            </label>
          </div>
          <label className="co-field">
            <span>Бренди</span>
            <input value={form.brands} onChange={set('brands')} placeholder="Shelly, Barbers, Joly Lab" />
          </label>
          <div className="co-grid-3">
            <label className="co-field">
              <span>Telegram</span>
              <input value={form.telegram} onChange={set('telegram')} placeholder="@username" autoCapitalize="none" />
            </label>
            <label className="co-field">
              <span>Телефон</span>
              <input value={form.phone} onChange={set('phone')} placeholder="+380…" inputMode="tel" />
            </label>
            <label className="co-field">
              <span>Пошта</span>
              <input value={form.email} onChange={set('email')} placeholder="name@company.com" inputMode="email" autoCapitalize="none" />
            </label>
          </div>
          <label className="co-field">
            <span>З яких питань звертатись</span>
            <textarea rows={6} value={form.duties} onChange={set('duties')} placeholder="Кожен пункт з нового рядка" />
          </label>
        </>
      )}
      <div className="co-form-foot">
        <button type="button" className="co-btn" onClick={onCancel}>Скасувати</button>
        <button type="submit" className="co-btn is-primary" disabled={!valid}>
          <Icon name="check" size={16} /> {isNew ? 'Додати' : 'Зберегти'}
        </button>
      </div>
    </form>
  );
}

// ─── Settings ───────────────────────────────────────────────

const SAVE_LABELS = {
  idle: 'Початкова версія — ще не змінювалась',
  saving: 'Збереження…',
  remote: 'Збережено для всіх',
  local: 'Збережено лише на цьому пристрої',
  loading: 'Завантаження…',
};

function SettingsPanel({ doc, editMode, setEditMode, saveState, onMeta, onImportExcel, onImportJson, onExport, onReset, onAddTop }) {
  const excelRef = useRef(null);
  const jsonRef = useRef(null);
  return (
    <div className="co-settings">
      <label className="co-switch-row">
        <span>
          <strong>Режим редагування</strong>
          <small>Додавайте, змінюйте, переміщуйте та видаляйте картки</small>
        </span>
        <input type="checkbox" className="co-switch" checked={editMode} onChange={(e) => setEditMode(e.target.checked)} />
      </label>

      <div className="co-section-title">Заголовок сторінки</div>
      <label className="co-field">
        <span>Назва</span>
        <input value={doc.title} onChange={(e) => onMeta({ title: e.target.value })} />
      </label>
      <label className="co-field">
        <span>Підзаголовок</span>
        <input value={doc.subtitle} onChange={(e) => onMeta({ subtitle: e.target.value })} placeholder="Напр. назва компанії" />
      </label>

      <div className="co-section-title">Швидкі дії</div>
      <div className="co-actions-grid">
        <button type="button" className="co-tile" onClick={() => onAddTop('unit')}>
          <Icon name="users" /> Новий підрозділ
        </button>
        <button type="button" className="co-tile" onClick={() => onAddTop('person')}>
          <Icon name="briefcase" /> Новий співробітник
        </button>
        <button type="button" className="co-tile" onClick={() => excelRef.current?.click()}>
          <Icon name="file" /> Імпорт з Excel
        </button>
        <button type="button" className="co-tile" onClick={onExport}>
          <Icon name="download" /> Експорт JSON
        </button>
        <button type="button" className="co-tile" onClick={() => jsonRef.current?.click()}>
          <Icon name="upload" /> Імпорт JSON
        </button>
        <button type="button" className="co-tile is-danger" onClick={onReset}>
          <Icon name="reset" /> Скинути до початкової
        </button>
      </div>
      <input
        ref={excelRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onImportExcel(file);
        }}
      />
      <input
        ref={jsonRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onImportJson(file);
        }}
      />
      <p className="co-hint">
        Excel має бути у форматі таблиці «Контакти»: блоки підрозділів у колонці A, далі №, ПІБ, Посада, Бренд,
        Телеграм, Телефон, Пошта та «з яких питань звертатись».
      </p>

      <div className={`co-sync is-${saveState}`}>
        <Icon name="cloud" size={16} />
        <span>
          {SAVE_LABELS[saveState]}
          {!isRemoteEnabled ? ' · спільне сховище не налаштоване' : ''}
        </span>
      </div>
    </div>
  );
}

// ─── App ────────────────────────────────────────────────────

function useCompanyAdmin() {
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    let requestId = 0;
    const check = async () => {
      const id = ++requestId;
      const phone = loadStoredUser()?.phone;
      setAllowed(phone ? null : false);
      if (!phone) return;
      const verified = await isApprovedCompanyAdmin(phone).catch(() => false);
      if (id === requestId) setAllowed(verified && loadStoredUser()?.phone === phone);
    };
    const onStorage = (event) => {
      if (event.key === USER_STORAGE_KEY || event.key === null) check();
    };
    const onPageShow = (event) => { if (event.persisted) check(); };
    check();
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      requestId++;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  return allowed;
}

export default function CompanyApp() {
  useTheme();
  const adminAccess = useCompanyAdmin();
  const canEdit = adminAccess === true;
  const cached = useMemo(() => readCache(), []);
  const [doc, setDoc] = useState(() => cached?.doc || seedDoc());
  const [history, setHistory] = useState([]);
  const [view, setView] = useState(() => readPref(VIEW_KEY, window.innerWidth < 760 ? 'list' : 'tree'));
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [form, setForm] = useState(null); // { draft, isNew }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditMode] = useState(false);
  const editMode = canEdit && editing;
  const [deleteId, setDeleteId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, text, action, danger }
  // On phones start with units folded so the whole department fits on screen.
  const [collapsed, setCollapsed] = useState(() => (window.innerWidth < 760
    ? new Set((cached?.doc || seedDoc()).nodes.filter((n) => n.type === 'unit').map((n) => n.id))
    : new Set()));
  const [saveState, setSaveState] = useState(isRemoteEnabled ? 'loading' : 'idle');
  const [toast, setToast] = useState('');
  const searchRef = useRef(null);
  const saveTimer = useRef(null);
  const toastTimer = useRef(null);
  const dirty = useRef(false);

  const index = useMemo(() => buildIndex(doc), [doc]);
  const stats = useMemo(() => ({
    people: doc.nodes.filter((n) => n.type === 'person').length,
    units: doc.nodes.filter((n) => n.type === 'unit').length,
  }), [doc]);

  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  useEffect(() => {
    if (canEdit) return;
    clearTimeout(saveTimer.current);
    setSettingsOpen(false);
    setEditMode(false);
    setForm(null);
    setDeleteId(null);
    setConfirm(null);
  }, [canEdit]);

  // Only a verified admin can upload an unsynced draft from this device.
  useEffect(() => {
    if (!isRemoteEnabled || adminAccess === null) return;
    let cancelled = false;
    fetchRemote()
      .then((remote) => {
        if (cancelled) return;
        if (dirty.current) return; // user already editing; their save wins
        const localUnsynced = canEdit && cached && !cached.synced;
        if (remote && !(localUnsynced && cached.doc.updatedAt > remote.updatedAt)) {
          setDoc(remote);
          // Keep any local admin draft intact while viewing as a guest.
          if (canEdit || !cached || cached.synced) writeCache(remote, true);
          setSaveState('remote');
        } else if (localUnsynced) {
          setSaveState('saving');
          saveDoc(cached.doc).then(setSaveState);
        } else {
          setSaveState('idle');
        }
      })
      .catch((error) => {
        console.warn('company_structure load failed:', error);
        if (!cancelled) setSaveState(cached && !cached.synced ? 'local' : 'idle');
      });
    return () => {
      cancelled = true;
    };
  }, [adminAccess, cached, canEdit]);

  const scheduleSave = useCallback((next) => {
    if (!canEdit) return;
    dirty.current = true;
    setSaveState('saving');
    writeCache(next, false);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDoc(next).then((result) => setSaveState(result));
    }, 700);
  }, [canEdit]);

  const commit = useCallback((next, message) => {
    if (next === doc) return;
    setHistory((h) => [...h.slice(-HISTORY_LIMIT + 1), doc]);
    setDoc(next);
    scheduleSave(next);
    if (message) notify(message);
    haptic('light');
  }, [doc, notify, scheduleSave]);

  const undo = () => {
    if (!history.length) return;
    const previous = { ...history[history.length - 1], updatedAt: new Date().toISOString() };
    setHistory(history.slice(0, -1));
    setDoc(previous);
    scheduleSave(previous);
    notify('Дію скасовано');
  };

  // "/" jumps to search from anywhere outside a text field.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('[data-co-modal]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Inside Telegram the native Back button closes the top-most layer.
  const layerOpen = Boolean(openId || form || settingsOpen || deleteId || confirm);
  const closeLayer = useRef(null);
  closeLayer.current = () => {
    if (confirm) setConfirm(null);
    else if (deleteId) setDeleteId(null);
    else if (form) setForm(null);
    else if (settingsOpen) setSettingsOpen(false);
    else setOpenId(null);
  };
  useEffect(() => {
    const back = telegramApp()?.BackButton;
    if (!back || !layerOpen) return undefined;
    const onBack = () => closeLayer.current();
    try {
      back.onClick(onBack);
      back.show();
    } catch {
      return undefined;
    }
    return () => {
      try {
        back.offClick(onBack);
        back.hide();
      } catch {
        // ignore
      }
    };
  }, [layerOpen]);

  // Close a sheet if its node disappeared (delete / undo / import).
  useEffect(() => {
    if (openId && !index.byId.has(openId)) setOpenId(null);
  }, [index, openId]);

  const changeView = (next) => {
    setView(next);
    writePref(VIEW_KEY, next);
  };

  const openNode = useCallback((id) => {
    setOpenId(id);
    setFocusId(id);
  }, []);

  const startAdd = useCallback((parentId, type) => {
    const parent = index.byId.get(parentId);
    const defaultType = type || (parent?.type === 'unit' || !parent ? 'person' : 'person');
    setForm({ isNew: true, draft: emptyNode({ type: defaultType, parentId: parentId || index.root?.id || null }) });
  }, [index]);

  const startEdit = useCallback((id) => {
    const node = index.byId.get(id);
    if (node) setForm({ isNew: false, draft: { ...node } });
  }, [index]);

  const saveForm = (values) => {
    if (form.isNew) {
      const next = addNode(doc, values);
      commit(next, values.type === 'unit' ? 'Підрозділ додано' : 'Співробітника додано');
      const added = next.nodes.find((n) => n.id === values.id);
      if (added?.parentId) setCollapsed((s) => { const c = new Set(s); c.delete(added.parentId); return c; });
      setFocusId(values.id);
    } else {
      commit(updateNode(doc, values.id, values), 'Зміни збережено');
    }
    setForm(null);
  };

  const requestDelete = (id) => setDeleteId(id);
  const doDelete = (mode) => {
    const node = index.byId.get(deleteId);
    commit(removeNode(doc, deleteId, mode), `${node?.type === 'unit' ? 'Підрозділ' : 'Картку'} видалено`);
    setDeleteId(null);
    setOpenId(null);
  };

  const ctx = {
    doc,
    index,
    editMode,
    highlightId: focusId,
    onOpen: openNode,
    onAdd: (id) => startAdd(id),
    onEdit: startEdit,
    collapsed,
    toggle: (id) => setCollapsed((s) => {
      const c = new Set(s);
      if (c.has(id)) c.delete(id);
      else c.add(id);
      return c;
    }),
    expandAll: () => setCollapsed(new Set()),
    collapseAll: () => setCollapsed(new Set(doc.nodes.filter((n) => n.parentId && index.children.get(n.id)?.length).map((n) => n.id))),
  };

  const importExcel = async (file) => {
    try {
      const { fileToDoc } = await import('./importRows');
      const next = await fileToDoc(file, { title: doc.title, subtitle: doc.subtitle });
      setConfirm({
        title: 'Замінити структуру?',
        text: `У файлі знайдено ${next.nodes.filter((n) => n.type === 'person').length} співробітників і ${next.nodes.filter((n) => n.type === 'unit').length} підрозділів. Поточну структуру буде замінено (можна скасувати).`,
        action: () => commit(next, 'Структуру імпортовано з Excel'),
      });
    } catch (error) {
      notify(error.message || 'Не вдалося прочитати файл');
    }
  };

  const importJson = async (file) => {
    try {
      const parsed = JSON.parse(await file.text());
      const next = normalizeDoc(parsed);
      if (!next.nodes.length) throw new Error('У файлі немає карток.');
      setConfirm({
        title: 'Замінити структуру?',
        text: `Буде завантажено ${next.nodes.length} карток з файлу. Поточну структуру буде замінено (можна скасувати).`,
        action: () => commit({ ...next, updatedAt: new Date().toISOString() }, 'Структуру імпортовано'),
      });
    } catch (error) {
      notify(error.message || 'Невірний JSON');
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `company-structure-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const reset = () => setConfirm({
    title: 'Скинути структуру?',
    text: 'Структура повернеться до початкової версії з Excel-файлу відділу. Цю дію можна скасувати кнопкою «Скасувати дію».',
    danger: true,
    action: () => commit({ ...seedDoc(), updatedAt: new Date().toISOString() }, 'Структуру скинуто'),
  });

  const deleting = deleteId ? index.byId.get(deleteId) : null;
  const deletingKids = deleting ? (index.children.get(deleting.id) || []).length : 0;
  const deletingAll = deleting ? getDescendantIds(doc, deleting.id).size : 0;

  return (
    <div className={`co-app ${editMode ? 'is-editing' : ''}`}>
      <header className="co-header">
        <div className="co-header-top">
          <div className="co-brand">
            <span className="co-brand-mark"><Icon name="building" size={20} /></span>
            <div>
              <h1>{doc.title}</h1>
              <p>
                {doc.subtitle ? `${doc.subtitle} · ` : ''}
                {stats.people} {pluralPeople(stats.people)} · {stats.units} підрозділів
              </p>
            </div>
          </div>
          <div className="co-header-actions">
            {editMode && history.length ? (
              <IconButton icon="undo" label="Скасувати дію" onClick={undo} />
            ) : null}
            {canEdit ? (
              <IconButton
                icon="settings"
                label="Налаштування"
                active={settingsOpen || editMode}
                onClick={() => setSettingsOpen(true)}
              />
            ) : null}
          </div>
        </div>
        <div className="co-toolbar">
          <label className="co-search">
            <Icon name="search" size={17} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                if (query) setQuery('');
                else e.currentTarget.blur();
              }}
              placeholder="Пошук: ім'я, посада, бренд…"
              aria-label="Пошук"
              enterKeyHint="search"
              autoComplete="off"
            />
            {query ? (
              <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus(); }} aria-label="Очистити пошук">
                <Icon name="close" size={15} />
              </button>
            ) : <kbd className="co-kbd" aria-hidden="true">/</kbd>}
          </label>
          <div className="co-view-toggle" role="group" aria-label="Вигляд">
            <button type="button" aria-pressed={view === 'tree'} title="Схема" className={view === 'tree' ? 'is-active' : ''} onClick={() => changeView('tree')}>
              <Icon name="tree" size={16} /> <span>Схема</span>
            </button>
            <button type="button" aria-pressed={view === 'list'} title="Список" className={view === 'list' ? 'is-active' : ''} onClick={() => changeView('list')}>
              <Icon name="list" size={16} /> <span>Список</span>
            </button>
          </div>
        </div>
        {editMode ? (
          <div className="co-edit-banner">
            <span><Icon name="edit" size={15} /> Режим редагування</span>
            <span className="co-edit-status">{SAVE_LABELS[saveState]}</span>
            <button type="button" onClick={() => setEditMode(false)}>Готово</button>
          </div>
        ) : null}
        {saveState === 'loading' ? <div className="co-progress" role="progressbar" aria-label="Завантаження структури" /> : null}
      </header>

      <main className="co-main">
        {query.trim() ? (
          <SearchResults doc={doc} query={query} onOpen={openNode} onClear={() => setQuery('')} />
        ) : !index.root ? (
          <div className="co-empty">
            <p>Структура порожня.</p>
            {canEdit ? (
              <button type="button" className="co-btn is-primary" onClick={() => setForm({ isNew: true, draft: emptyNode({ type: 'person' }) })}>
                <Icon name="plus" size={16} /> Додати керівника
              </button>
            ) : null}
          </div>
        ) : view === 'tree' ? (
          <TreeView ctx={ctx} focusId={focusId} />
        ) : (
          <ListView ctx={ctx} />
        )}
      </main>

      <Sheet open={Boolean(openId)} onClose={() => setOpenId(null)} title={index.byId.get(openId)?.type === 'unit' ? 'Підрозділ' : 'Співробітник'}>
        {openId ? (
          <NodeDetails
            doc={doc}
            nodeId={openId}
            onOpen={openNode}
            onEdit={startEdit}
            onAdd={(id) => startAdd(id)}
            onDelete={requestDelete}
            onMove={(id, dir) => commit(moveSibling(doc, id, dir))}
            editMode={editMode}
            notify={notify}
          />
        ) : null}
      </Sheet>

      <Sheet
        open={canEdit && Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.isNew ? 'Нова картка' : 'Редагування'}
        wide
      >
        {form ? (
          <NodeForm
            key={form.draft.id}
            doc={doc}
            draft={form.draft}
            isNew={form.isNew}
            onCancel={() => setForm(null)}
            onSave={saveForm}
          />
        ) : null}
      </Sheet>

      <Sheet open={canEdit && settingsOpen} onClose={() => setSettingsOpen(false)} title="Налаштування">
        <SettingsPanel
          doc={doc}
          editMode={editMode}
          setEditMode={(value) => {
            setEditMode(value);
            if (value) setSettingsOpen(false);
          }}
          saveState={saveState}
          onMeta={(patch) => {
            const next = { ...doc, ...patch, updatedAt: new Date().toISOString() };
            setDoc(next);
            scheduleSave(next);
          }}
          onImportExcel={importExcel}
          onImportJson={importJson}
          onExport={exportJson}
          onReset={reset}
          onAddTop={(type) => {
            setSettingsOpen(false);
            setEditMode(true);
            startAdd(index.root?.id, type);
          }}
        />
      </Sheet>

      {canEdit && deleting ? (
        <Dialog
          onClose={() => setDeleteId(null)}
          title={`Видалити «${deleting.type === 'unit' ? deleting.title : deleting.name || deleting.title}»?`}
        >
          {deletingKids ? (
            <>
              <p>У картці є підлеглі ({deletingAll}). Що з ними зробити?</p>
              <div className="co-dialog-actions is-column">
                {deleting.parentId || deletingKids === 1 ? (
                  <button type="button" className="co-btn is-primary" onClick={() => doDelete('reassign')}>
                    Перевести підлеглих на рівень вище
                  </button>
                ) : null}
                <button type="button" className="co-btn is-danger" onClick={() => doDelete('cascade')}>
                  Видалити разом з усіма підлеглими
                </button>
                <button type="button" className="co-btn" onClick={() => setDeleteId(null)}>Скасувати</button>
              </div>
            </>
          ) : (
            <div className="co-dialog-actions">
              <button type="button" className="co-btn" onClick={() => setDeleteId(null)}>Скасувати</button>
              <button type="button" className="co-btn is-danger" onClick={() => doDelete('reassign')}>Видалити</button>
            </div>
          )}
        </Dialog>
      ) : null}

      {canEdit && confirm ? (
        <Dialog onClose={() => setConfirm(null)} title={confirm.title}>
          <p>{confirm.text}</p>
          <div className="co-dialog-actions">
            <button type="button" className="co-btn" onClick={() => setConfirm(null)}>Скасувати</button>
            <button
              type="button"
              className={`co-btn ${confirm.danger ? 'is-danger' : 'is-primary'}`}
              onClick={() => {
                confirm.action();
                setConfirm(null);
                setSettingsOpen(false);
              }}
            >
              Підтвердити
            </button>
          </div>
        </Dialog>
      ) : null}

      <div className={`co-toast ${toast ? 'is-visible' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
