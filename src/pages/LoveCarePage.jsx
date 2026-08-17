import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeImage } from '../components/SafeImage';
import { productDisplayText } from '../lib/productDisplay';

function formatPrice(price) {
  return Number(price || 0).toLocaleString('uk-UA');
}

function shuffleProducts(products) {
  const next = [...products];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
  }
  return next;
}

export function LoveCarePage({ products, userName, onBack, onReaction }) {
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const shuffledProducts = useMemo(
    () => shuffleProducts(products.filter((product) => product?.view !== false)),
    [products, shuffleSeed] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [exitReaction, setExitReaction] = useState('');
  const [reactionCount, setReactionCount] = useState({ like: 0, dislike: 0 });
  const pointerStartRef = useRef(null);
  const transitionTimerRef = useRef(null);

  const currentProduct = shuffledProducts[currentIndex];
  const nextProduct = shuffledProducts[currentIndex + 1];
  const currentCategory = productDisplayText(currentProduct?.category, 'Твій вибір');
  const currentBadge = productDisplayText(currentProduct?.badge);
  const currentSubCategory = productDisplayText(currentProduct?.p_category);
  const isAnimating = Boolean(exitReaction);
  const dragReaction = exitReaction || (drag.x > 38 ? 'like' : drag.x < -38 ? 'dislike' : '');

  useEffect(() => () => {
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
  }, []);

  const chooseProduct = useCallback((reaction) => {
    if (!currentProduct || isAnimating) return;

    setExitReaction(reaction);
    setDrag({
      x: reaction === 'like' ? window.innerWidth * 1.15 : -window.innerWidth * 1.15,
      y: -18,
    });
    setReactionCount((current) => ({
      ...current,
      [reaction]: current[reaction] + 1,
    }));
    onReaction?.(currentProduct, reaction);

    transitionTimerRef.current = window.setTimeout(() => {
      setCurrentIndex((index) => index + 1);
      setDrag({ x: 0, y: 0 });
      setExitReaction('');
      pointerStartRef.current = null;
    }, 320);
  }, [currentProduct, isAnimating, onReaction]);

  const handlePointerDown = (event) => {
    if (!currentProduct || isAnimating) return;
    pointerStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId || isAnimating) return;
    setDrag({
      x: event.clientX - start.x,
      y: (event.clientY - start.y) * 0.22,
    });
  };

  const finishPointerGesture = (event) => {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId || isAnimating) return;
    pointerStartRef.current = null;

    if (Math.abs(drag.x) >= 82) {
      chooseProduct(drag.x > 0 ? 'like' : 'dislike');
      return;
    }

    setDrag({ x: 0, y: 0 });
  };

  const restart = () => {
    setCurrentIndex(0);
    setReactionCount({ like: 0, dislike: 0 });
    setDrag({ x: 0, y: 0 });
    setExitReaction('');
    setShuffleSeed((seed) => seed + 1);
  };

  return (
    <main
      className="lovecare-page"
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') chooseProduct('dislike');
        if (event.key === 'ArrowRight') chooseProduct('like');
      }}
    >
      <div className="lovecare-orb lovecare-orb--one" />
      <div className="lovecare-orb lovecare-orb--two" />

      <header className="lovecare-header">
        <button type="button" className="lovecare-back" onClick={onBack} aria-label="Повернутися до каталогу">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="lovecare-brand">
          <span className="lovecare-brand-heart" aria-hidden="true">♥</span>
          <div>
            <div className="lovecare-title">LoveCare</div>
            <div className="lovecare-subtitle">Знайди свій perfect match</div>
          </div>
        </div>
        <div className="lovecare-progress" aria-label={`Переглянуто ${currentIndex} з ${shuffledProducts.length}`}>
          {Math.min(currentIndex + 1, shuffledProducts.length)}<span>/</span>{shuffledProducts.length}
        </div>
      </header>

      <section className="lovecare-stage" aria-live="polite">
        {nextProduct && (
          <article className="lovecare-card lovecare-card--next" aria-hidden="true">
            <SafeImage className="lovecare-card-image" src={nextProduct.thumbnail_url} alt="" loading="eager" />
          </article>
        )}

        {currentProduct ? (
          <article
            className={`lovecare-card lovecare-card--active ${isAnimating ? 'is-exiting' : ''}`}
            style={{
              transform: `translate3d(${drag.x}px, ${drag.y}px, 0) rotate(${drag.x / 19}deg)`,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointerGesture}
            onPointerCancel={finishPointerGesture}
            tabIndex={0}
          >
            <div className={`lovecare-stamp lovecare-stamp--like ${dragReaction === 'like' ? 'is-visible' : ''}`}>ПОДОБАЄТЬСЯ</div>
            <div className={`lovecare-stamp lovecare-stamp--nope ${dragReaction === 'dislike' ? 'is-visible' : ''}`}>НЕ МОЄ</div>
            <SafeImage
              className="lovecare-card-image"
              src={currentProduct.thumbnail_url}
              alt={currentProduct.name}
              loading="eager"
              fetchPriority="high"
              draggable="false"
            />
            <div className="lovecare-card-shade" />
            <div className="lovecare-card-content">
              <div className="lovecare-card-kicker">
                <span>{currentCategory}</span>
                {currentBadge && <b>{currentBadge}</b>}
              </div>
              <h1>{productDisplayText(currentProduct.name, 'Товар')}</h1>
              {currentSubCategory && <p>{currentSubCategory}</p>}
              <div className="lovecare-price">{formatPrice(currentProduct.price)} ₴</div>
            </div>
          </article>
        ) : (
          <div className="lovecare-finished">
            <div className="lovecare-finished-heart">♥</div>
            <h1>Оце була хімія!</h1>
            <p>{userName ? `${userName}, твої` : 'Твої'} відповіді збережено в LoveCare.</p>
            <div className="lovecare-summary">
              <span>♥ {reactionCount.like} подобається</span>
              <span>× {reactionCount.dislike} не моє</span>
            </div>
            <button type="button" onClick={restart}>Спробувати ще раз</button>
          </div>
        )}
      </section>

      {currentProduct && (
        <footer className="lovecare-actions">
          <button type="button" className="lovecare-action lovecare-action--nope" onClick={() => chooseProduct('dislike')} aria-label="Не подобається">
            <span aria-hidden="true">×</span>
            <small>Не моє</small>
          </button>
          <div className="lovecare-hint">свайпни<br />картку</div>
          <button type="button" className="lovecare-action lovecare-action--like" onClick={() => chooseProduct('like')} aria-label="Подобається">
            <span aria-hidden="true">♥</span>
            <small>Подобається</small>
          </button>
        </footer>
      )}
    </main>
  );
}
