import React, { useEffect, useRef, useState } from 'react';
import { fetchLatestAccessByPhone, logAccess } from '../lib/supabase';

const PHONE_PREFIX = '+380';
const PHONE_DIGITS_COUNT = 12;
const PHONE_PATTERN = /^\+380\d{9}$/;

function normalizePhoneInput(value) {
  const digits = value.replace(/\D/g, '');
  let nationalDigits = digits;

  if (digits.startsWith('380')) {
    nationalDigits = digits.slice(3);
  } else if (digits.startsWith('0')) {
    nationalDigits = digits.slice(1);
  }

  return `${PHONE_PREFIX}${nationalDigits.slice(0, PHONE_DIGITS_COUNT - 3)}`;
}

function isPhoneComplete(value) {
  return PHONE_PATTERN.test(value);
}

export function GatePage({ onAuthorized, tgUserId }) {
  const [phone, setPhone] = useState(PHONE_PREFIX);
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nameSuggestion, setNameSuggestion] = useState('');
  const [nameLookupStatus, setNameLookupStatus] = useState('idle');
  const autoFilledNameRef = useRef('');
  const lastNameRef = useRef('');
  const nameEditedRef = useRef(false);

  const phoneComplete = isPhoneComplete(phone);
  const canSubmit = phoneComplete && lastName.trim().length >= 1;

  useEffect(() => {
    setNameSuggestion('');

    if (!phoneComplete) {
      setNameLookupStatus('idle');
      return undefined;
    }

    let cancelled = false;
    setNameLookupStatus('loading');

    const timer = window.setTimeout(async () => {
      try {
        const latestAccess = await fetchLatestAccessByPhone(phone);
        if (cancelled) return;

        const suggestedName = latestAccess?.last_name?.trim() || '';
        setNameSuggestion(suggestedName);
        setNameLookupStatus(suggestedName ? 'found' : 'idle');

        const canAutoFill =
          suggestedName &&
          (!nameEditedRef.current || !lastNameRef.current.trim() || lastNameRef.current.trim() === autoFilledNameRef.current);

        if (canAutoFill) {
          autoFilledNameRef.current = suggestedName;
          lastNameRef.current = suggestedName;
          nameEditedRef.current = false;
          setLastName(suggestedName);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn('Name lookup error:', err);
        setNameLookupStatus('idle');
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phone, phoneComplete]);

  const applyNameSuggestion = () => {
    if (!nameSuggestion) return;
    autoFilledNameRef.current = nameSuggestion;
    lastNameRef.current = nameSuggestion;
    nameEditedRef.current = false;
    setLastName(nameSuggestion);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    if (!phoneComplete) {
      setError('Введіть повний номер у форматі +380XXXXXXXXX.');
      return;
    }

    if (!lastName.trim()) {
      setError('Введіть ім\'я та прізвище.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Записати вхід в Supabase access_log
      await logAccess({
        phone: phone.trim(),
        lastName: lastName.trim(),
        tgUserId,
      });

      // Передати дані батьківському компоненту
      onAuthorized({
        phone: phone.trim(),
        lastName: lastName.trim(),
      });
    } catch (err) {
      console.error('Gate error:', err);
      setError('Помилка з\'єднання. Спробуйте ще раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="gate-page">
      <div className="gate-logo">🛍</div>
      <h1 className="gate-title">Вітаємо!</h1>
      <p className="gate-subtitle">
        Для перегляду введіть номер телефону, ім'я та прізвище
      </p>

      <form className="gate-form" onSubmit={handleSubmit}>
        <input
          className="gate-input"
          type="tel"
          inputMode="numeric"
          placeholder="+380502847652"
          value={phone}
          onChange={(e) => {
            const nextPhone = normalizePhoneInput(e.target.value);
            if (lastNameRef.current.trim() && lastNameRef.current.trim() === autoFilledNameRef.current) {
              lastNameRef.current = '';
              autoFilledNameRef.current = '';
              nameEditedRef.current = false;
              setLastName('');
            }
            setPhone(nextPhone);
            setError('');
          }}
          autoComplete="tel"
          maxLength={13}
          aria-invalid={!phoneComplete && phone !== PHONE_PREFIX}
          onFocus={(e) => e.currentTarget.select()}
        />
        <input
          className="gate-input"
          type="text"
          placeholder="Ім'я та Прізвище"
          value={lastName}
          onChange={(e) => {
            lastNameRef.current = e.target.value;
            nameEditedRef.current = true;
            setLastName(e.target.value);
            setError('');
          }}
          autoComplete="name"
        />

        {nameLookupStatus === 'loading' && (
          <div className="gate-suggestion">Перевіряю попередній вхід…</div>
        )}
        {nameSuggestion && (
          <button
            className="gate-suggestion gate-suggestion-btn"
            type="button"
            onClick={applyNameSuggestion}
          >
            Останній запис: {nameSuggestion}
          </button>
        )}

        {error && <div className="gate-error">{error}</div>}

        <button
          className="gate-btn"
          type="submit"
          disabled={!canSubmit || loading}
        >
          {loading ? 'Зачекайте…' : 'Увійти'}
        </button>
      </form>

      <p className="gate-note">
        З вами зв'яжеться менеджер для уточнення деталей та оплати.
      </p>
    </div>
  );
}
