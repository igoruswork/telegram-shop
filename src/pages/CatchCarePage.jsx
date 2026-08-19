import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const ROUND_SECONDS = 55;
const STARTING_LIVES = 4;

const GAME_PRODUCTS = [
  {
    sku: '4823109414259',
    shortName: 'Ензимна пудра',
    image: './game-assets/product-4823109414259.png',
    effect: 'powder',
    effectLabel: 'Хмарка пудри!',
  },
  {
    sku: '4823109412033',
    shortName: 'Глиняна маска',
    image: './game-assets/product-4823109412033.png',
    effect: 'dark',
    effectLabel: 'Глиняний режим!',
  },
  {
    sku: '4823109414174',
    shortName: 'SPF 50',
    image: './game-assets/product-4823109414174.png',
    effect: 'sun',
    effectLabel: 'Сонечко сяє!',
  },
  {
    sku: '4823109412286',
    shortName: 'Бальзам для губ',
    image: './game-assets/product-4823109412286.png',
    effect: 'lips',
    effectLabel: 'Wow-губи!',
  },
  {
    sku: '4823109410077',
    shortName: 'Кислотний пілінг',
    image: './game-assets/product-4823109410077.png',
    effect: 'red',
    effectLabel: 'Обережно, пілінг!',
  },
  {
    sku: '4823109410220',
    shortName: 'Пінка для вмивання',
    image: './game-assets/product-4823109410220.png',
    effect: 'bubbles',
    effectLabel: 'Бульбашки!',
  },
  {
    sku: '4823109409323',
    shortName: 'Заспокійлива сироватка',
    image: './game-assets/product-4823109409323.png',
    effect: 'calm',
    effectLabel: 'Повний спокій',
  },
];

const BAGS = {
  black: {
    label: 'Чорний пакет',
    image: './game-assets/bag-black-cutout.png',
  },
  purple: {
    label: 'Фіолетовий пакет',
    image: './game-assets/bag-purple-cutout.png',
  },
};

const HAZARDS = [
  { icon: '✂️', label: 'Ножиці' },
  { icon: '🔥', label: 'Гаряче' },
  { icon: '💣', label: 'Бум' },
  { icon: '🦠', label: 'Бактерія' },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  return `0:${String(safeSeconds).padStart(2, '0')}`;
}

export function CatchCarePage({
  products,
  userName,
  onBack,
  onResult,
  onSessionOpen,
  onHaptic,
  onHapticNotification,
}) {
  const [phase, setPhase] = useState('intro');
  const [selectedBag, setSelectedBag] = useState(null);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(STARTING_LIVES);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [items, setItems] = useState([]);
  const [heroX, setHeroX] = useState(50);
  const [activeEffect, setActiveEffect] = useState('');
  const [effectLabel, setEffectLabel] = useState('');
  const [finishReason, setFinishReason] = useState('');
  const [saveState, setSaveState] = useState('idle');

  const stageRef = useRef(null);
  const bagRef = useRef(null);
  const itemNodesRef = useRef(new Map());
  const itemsRef = useRef([]);
  const spawnTimeoutRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const collisionFrameRef = useRef(null);
  const collisionLastCheckRef = useRef(0);
  const effectTimeoutRef = useRef(null);
  const startedAtRef = useRef(0);
  const scoreRef = useRef(0);
  const livesRef = useRef(STARTING_LIVES);
  const caughtProductsRef = useRef({});
  const finishingRef = useRef(false);
  const itemSequenceRef = useRef(0);
  const sessionRecordedRef = useRef(false);

  const productNames = useMemo(
    () => new Map((products || []).map((product) => [String(product.sku || ''), product.name])),
    [products]
  );
  const isLowPowerDevice = useMemo(() => {
    const memory = Number(navigator.deviceMemory || 8);
    return navigator.hardwareConcurrency <= 4 || memory <= 4;
  }, []);

  const selectedBagDetails = selectedBag ? BAGS[selectedBag] : null;
  const timeLeft = Math.max(0, ROUND_SECONDS - elapsedSeconds);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (sessionRecordedRef.current) return;
    sessionRecordedRef.current = true;
    Promise.resolve(onSessionOpen?.()).catch((error) => {
      console.warn('Beauty лов session save error:', error);
    });
  }, [onSessionOpen]);

  const clearGameTimers = useCallback(() => {
    if (spawnTimeoutRef.current) window.clearTimeout(spawnTimeoutRef.current);
    if (timerIntervalRef.current) window.clearInterval(timerIntervalRef.current);
    if (collisionFrameRef.current) window.cancelAnimationFrame(collisionFrameRef.current);
    if (effectTimeoutRef.current) window.clearTimeout(effectTimeoutRef.current);
    spawnTimeoutRef.current = null;
    timerIntervalRef.current = null;
    collisionFrameRef.current = null;
    effectTimeoutRef.current = null;
  }, []);

  const finishGame = useCallback((reason = 'hazard') => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    clearGameTimers();

    const durationSeconds = Math.max(
      1,
      Math.min(ROUND_SECONDS, Math.round((performance.now() - startedAtRef.current) / 1000))
    );
    const result = {
      bagType: selectedBag,
      score: scoreRef.current,
      caughtProducts: caughtProductsRef.current,
      durationSeconds,
      endedReason: reason,
    };

    setElapsedSeconds(durationSeconds);
    setFinishReason(reason);
    setPhase('finished');
    setItems([]);
    setSaveState('saving');

    Promise.resolve(onResult?.(result))
      .then(() => setSaveState('saved'))
      .catch(() => setSaveState('error'));
  }, [clearGameTimers, onResult, selectedBag]);

  const showProductEffect = useCallback((product) => {
    if (effectTimeoutRef.current) window.clearTimeout(effectTimeoutRef.current);
    setActiveEffect(product.effect);
    setEffectLabel(product.effectLabel);
    effectTimeoutRef.current = window.setTimeout(() => {
      setActiveEffect('');
      setEffectLabel('');
    }, 2100);
  }, []);

  const removeItem = useCallback((itemId) => {
    itemNodesRef.current.delete(itemId);
    setItems((current) => current.filter((item) => item.id !== itemId));
  }, []);

  const catchItem = useCallback((item) => {
    removeItem(item.id);

    if (item.kind === 'hazard') {
      const nextLives = Math.max(0, livesRef.current - 1);
      livesRef.current = nextLives;
      setLives(nextLives);
      onHapticNotification?.('error');
      setActiveEffect('hit');
      setEffectLabel(`Ой! ${item.label}`);
      if (effectTimeoutRef.current) window.clearTimeout(effectTimeoutRef.current);
      effectTimeoutRef.current = window.setTimeout(() => {
        setActiveEffect('');
        setEffectLabel('');
      }, 1300);
      if (nextLives === 0) finishGame('hazard');
      return;
    }

    scoreRef.current += 1;
    caughtProductsRef.current[item.sku] = (caughtProductsRef.current[item.sku] || 0) + 1;
    setScore(scoreRef.current);
    onHapticNotification?.('success');
    showProductEffect(item);
  }, [finishGame, onHapticNotification, removeItem, showProductEffect]);

  const spawnItem = useCallback(() => {
    if (finishingRef.current) return;

    const isHazard = Math.random() < 0.12;
    const source = isHazard
      ? HAZARDS[Math.floor(Math.random() * HAZARDS.length)]
      : GAME_PRODUCTS[Math.floor(Math.random() * GAME_PRODUCTS.length)];
    const speed = Math.max(3.25, 6.8 - scoreRef.current * 0.08);
    const nextItem = {
      ...source,
      id: `fall-${Date.now()}-${itemSequenceRef.current += 1}`,
      kind: isHazard ? 'hazard' : 'product',
      left: 8 + Math.random() * 84,
      duration: speed * (0.88 + Math.random() * 0.22),
      rotation: -14 + Math.random() * 28,
    };
    setItems((current) => [...current, nextItem].slice(-10));

    const nextDelay = Math.max(650, 1170 - scoreRef.current * 12);
    spawnTimeoutRef.current = window.setTimeout(spawnItem, nextDelay);
  }, []);

  useEffect(() => {
    if (phase !== 'playing') return undefined;

    spawnTimeoutRef.current = window.setTimeout(spawnItem, 700);
    timerIntervalRef.current = window.setInterval(() => {
      const nextElapsed = (performance.now() - startedAtRef.current) / 1000;
      setElapsedSeconds(nextElapsed);
      if (nextElapsed >= ROUND_SECONDS) finishGame('time');
    }, 500);

    const checkCollisions = () => {
      const now = performance.now();
      if (now - collisionLastCheckRef.current < 34) {
        collisionFrameRef.current = window.requestAnimationFrame(checkCollisions);
        return;
      }
      collisionLastCheckRef.current = now;
      const bagRect = bagRef.current?.getBoundingClientRect();
      if (bagRect) {
        for (const item of itemsRef.current) {
          const node = itemNodesRef.current.get(item.id);
          if (!node || node.dataset.caught === 'true') continue;
          const itemRect = node.getBoundingClientRect();
          const overlapsHorizontally = itemRect.right > bagRect.left + 12
            && itemRect.left < bagRect.right - 12;
          const entersBag = itemRect.bottom >= bagRect.top + 14
            && itemRect.top < bagRect.bottom - 12;

          if (overlapsHorizontally && entersBag) {
            node.dataset.caught = 'true';
            catchItem(item);
          }
        }
      }
      collisionFrameRef.current = window.requestAnimationFrame(checkCollisions);
    };

    collisionFrameRef.current = window.requestAnimationFrame(checkCollisions);
    return clearGameTimers;
  }, [catchItem, clearGameTimers, finishGame, phase, spawnItem]);

  useEffect(() => clearGameTimers, [clearGameTimers]);

  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'ArrowLeft') setHeroX((current) => clamp(current - 7, 10, 90));
      if (event.key === 'ArrowRight') setHeroX((current) => clamp(current + 7, 10, 90));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase]);

  const startGame = () => {
    if (!selectedBag) return;
    clearGameTimers();
    finishingRef.current = false;
    scoreRef.current = 0;
    livesRef.current = STARTING_LIVES;
    caughtProductsRef.current = {};
    itemNodesRef.current.clear();
    collisionLastCheckRef.current = 0;
    startedAtRef.current = performance.now();
    setScore(0);
    setLives(STARTING_LIVES);
    setElapsedSeconds(0);
    setHeroX(50);
    setItems([]);
    setActiveEffect('');
    setEffectLabel('');
    setFinishReason('');
    setSaveState('idle');
    setPhase('playing');
    onHaptic?.('medium');
  };

  const handleStagePointer = (event) => {
    if (phase !== 'playing' || !stageRef.current) return;
    const bounds = stageRef.current.getBoundingClientRect();
    const nextX = ((event.clientX - bounds.left) / bounds.width) * 100;
    setHeroX(clamp(nextX, 10, 90));
  };

  const caughtSummary = Object.entries(caughtProductsRef.current)
    .map(([sku, count]) => ({
      sku,
      count,
      name: GAME_PRODUCTS.find((product) => product.sku === sku)?.shortName || sku,
    }))
    .sort((left, right) => right.count - left.count);

  return (
    <main className={`catchcare-page is-${phase} effect-${activeEffect || 'none'}${isLowPowerDevice ? ' is-lightweight' : ''}`}>
      <header className="catchcare-header">
        <button type="button" className="catchcare-back" onClick={onBack} aria-label="Повернутися до каталогу">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="catchcare-brand">
          <span aria-hidden="true">♥</span>
          <div><b>Beauty лов</b><small>beauty drop</small></div>
        </div>
        {phase === 'playing' ? (
          <div className="catchcare-hud-mini"><b>{score}</b><small>товарів</small></div>
        ) : <div className="catchcare-header-dot" />}
      </header>

      {phase === 'intro' && (
        <section className="catchcare-intro">
          <div className="catchcare-intro-heart" aria-hidden="true">♥</div>
          <h1>Beauty лов</h1>

          <div className="catchcare-bag-picker" aria-label="Оберіть пакет">
            {Object.entries(BAGS).map(([key, bag]) => (
              <button
                key={key}
                type="button"
                className={selectedBag === key ? 'is-selected' : ''}
                aria-label={`Обрати: ${bag.label}`}
                onClick={() => {
                  setSelectedBag(key);
                  onHaptic?.('light');
                }}
              >
                <span className="catchcare-bag-preview"><img src={bag.image} alt="" /></span>
              </button>
            ))}
          </div>

          <button type="button" className="catchcare-start" disabled={!selectedBag} onClick={startGame}>
            <span>Старт</span><b>→</b>
          </button>
          <div className="catchcare-intro-rules"><span>♥ 4 життя</span><span>◷ 55 секунд</span><span>⚡ стає швидше</span></div>
        </section>
      )}

      {phase === 'playing' && (
        <section
          ref={stageRef}
          className="catchcare-stage"
          onPointerDown={handleStagePointer}
          onPointerMove={(event) => {
            if (event.buttons || event.pointerType === 'touch') handleStagePointer(event);
          }}
        >
          <div className="catchcare-game-hud">
            <div className="catchcare-lives" aria-label={`${lives} життя`}>
              {Array.from({ length: STARTING_LIVES }, (_, index) => <span key={index} className={index < lives ? 'is-live' : ''}>♥</span>)}
            </div>
            <div className="catchcare-timer">{formatTime(timeLeft)}</div>
          </div>

          <div className="catchcare-speed-meter">
            <span>Швидкість</span><i><b style={{ width: `${Math.min(100, 18 + score * 4)}%` }} /></i>
          </div>

          {items.map((item) => (
            <div
              key={item.id}
              ref={(node) => {
                if (node) itemNodesRef.current.set(item.id, node);
                else itemNodesRef.current.delete(item.id);
              }}
              className={`catchcare-falling-item is-${item.kind}`}
              style={{
                '--item-left': `${item.left}%`,
                '--fall-duration': `${item.duration}s`,
                '--item-rotation': `${item.rotation}deg`,
              }}
              onAnimationEnd={() => removeItem(item.id)}
              aria-label={item.kind === 'product' ? (productNames.get(item.sku) || item.shortName) : item.label}
            >
              {item.kind === 'product'
                ? <img src={item.image} alt="" draggable="false" />
                : <span aria-hidden="true">{item.icon}</span>}
            </div>
          ))}

          {activeEffect === 'sun' && <div className="catchcare-sun" aria-hidden="true">☀</div>}
          {activeEffect === 'powder' && <div className="catchcare-powder" aria-hidden="true">{Array.from({ length: isLowPowerDevice ? 4 : 8 }, (_, index) => <i key={index} style={{ '--i': index }} />)}</div>}
          {activeEffect === 'bubbles' && <div className="catchcare-bubbles" aria-hidden="true">{Array.from({ length: isLowPowerDevice ? 4 : 7 }, (_, index) => <i key={index} style={{ '--i': index }} />)}</div>}
          {activeEffect === 'calm' && <div className="catchcare-calm-waves" aria-hidden="true"><i />{!isLowPowerDevice && <i />}</div>}
          {effectLabel && <div className="catchcare-effect-label" role="status">{effectLabel}</div>}

          <div className={`catchcare-hero is-${selectedBag}`} style={{ left: `${heroX}%` }}>
            <div className="catchcare-avatar" aria-hidden="true">
              <span className="catchcare-hair" />
              <span className="catchcare-eye catchcare-eye--left" />
              <span className="catchcare-eye catchcare-eye--right" />
              <span className="catchcare-mouth" />
            </div>
            <img ref={bagRef} className="catchcare-player-bag" src={selectedBagDetails.image} alt={`${selectedBagDetails.label} пакет`} draggable="false" />
          </div>
          <p className="catchcare-drag-hint">← веди пакет →</p>
        </section>
      )}

      {phase === 'finished' && (
        <section className="catchcare-finish">
          <div className="catchcare-finish-crown" aria-hidden="true">✦</div>
          <p className="catchcare-eyebrow">{finishReason === 'time' ? 'час вийшов' : 'гра завершена'}</p>
          <h1>{scoreRef.current ? 'Beauty улов!' : 'Спробуємо ще?'}</h1>
          <p>{userName ? `${userName}, твій результат` : 'Твій результат'}</p>
          <div className="catchcare-result-score"><b>{scoreRef.current}</b><span>спіймано<br />товарів</span></div>
          <div className="catchcare-result-meta"><span>◷ {Math.round(elapsedSeconds)} с</span><span>♥ {livesRef.current}</span><span>{selectedBag === 'black' ? 'Black' : 'Purple'}</span></div>

          {caughtSummary.length > 0 && (
            <div className="catchcare-caught-list">
              {caughtSummary.slice(0, 4).map((entry) => <span key={entry.sku}>{entry.name}<b>×{entry.count}</b></span>)}
            </div>
          )}

          <div className={`catchcare-save-state is-${saveState}`}>
            {saveState === 'saving' && 'Зберігаємо результат…'}
            {saveState === 'saved' && '✓ Результат збережено'}
            {saveState === 'error' && 'Результат залишився на екрані; таблицю логів ще треба застосувати'}
          </div>
          <button type="button" className="catchcare-replay" onClick={startGame}>Повторити <span>↻</span></button>
          <button type="button" className="catchcare-change-bag" onClick={() => setPhase('intro')}>Обрати інший пакет</button>
        </section>
      )}
    </main>
  );
}
