import React, { useEffect, useRef, useState } from 'react';
import { fetchLatestAccessByPhone, fetchLatestAccessByPhonePrefix, logAccess } from '../lib/supabase';

const PHONE_PREFIX = '+380';
const PHONE_DIGITS_COUNT = 12;
const PHONE_PATTERN = /^\+380\d{9}$/;
const EARLY_LOOKUP_NATIONAL_DIGITS = 5;

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

function getNationalDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.startsWith('380') ? digits.slice(3) : digits;
}

function getEarlyPhoneLookupPrefix(value) {
  const nationalDigits = getNationalDigits(value);
  if (nationalDigits.length < EARLY_LOOKUP_NATIONAL_DIGITS) return '';

  return `${PHONE_PREFIX}${nationalDigits.slice(0, EARLY_LOOKUP_NATIONAL_DIGITS)}`;
}

export function GatePage({ onAuthorized, tgUserId }) {
  const [phone, setPhone] = useState(PHONE_PREFIX);
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const autoFilledNameRef = useRef('');
  const autoFilledPhoneRef = useRef('');
  const lastNameRef = useRef('');
  const nameEditedRef = useRef(false);

  const phoneComplete = isPhoneComplete(phone);
  const earlyPhoneLookupPrefix = getEarlyPhoneLookupPrefix(phone);
  const canSubmit = phoneComplete && lastName.trim().length >= 1;

  const applyLatestAccess = (latestAccess, fallbackPhone) => {
    const suggestedName = latestAccess?.last_name?.trim() || '';
    const suggestedPhone = latestAccess?.phone?.trim() || fallbackPhone;
    const canAutoFill =
      suggestedName &&
      (!nameEditedRef.current || !lastNameRef.current.trim() || lastNameRef.current.trim() === autoFilledNameRef.current);

    if (canAutoFill) {
      autoFilledNameRef.current = suggestedName;
      autoFilledPhoneRef.current = suggestedPhone;
      lastNameRef.current = suggestedName;
      nameEditedRef.current = false;
      setLastName(suggestedName);
    }
  };

  useEffect(() => {
    if (!earlyPhoneLookupPrefix) {
      return undefined;
    }

    let cancelled = false;

    const timer = window.setTimeout(async () => {
      try {
        const latestAccess = await fetchLatestAccessByPhonePrefix(earlyPhoneLookupPrefix);
        if (cancelled) return;
        applyLatestAccess(latestAccess, earlyPhoneLookupPrefix);
      } catch (err) {
        if (cancelled) return;
        console.warn('Name lookup error:', err);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [earlyPhoneLookupPrefix]);

  useEffect(() => {
    if (!phoneComplete) {
      return undefined;
    }

    let cancelled = false;

    const timer = window.setTimeout(async () => {
      try {
        const latestAccess = await fetchLatestAccessByPhone(phone);
        if (cancelled) return;
        applyLatestAccess(latestAccess, phone);
      } catch (err) {
        if (cancelled) return;
        console.warn('Name lookup error:', err);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phone, phoneComplete]);

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
            const nextNationalDigits = getNationalDigits(nextPhone);
            const shouldClearAutoFilledName =
              lastNameRef.current.trim() &&
              lastNameRef.current.trim() === autoFilledNameRef.current &&
              (
                nextNationalDigits.length < EARLY_LOOKUP_NATIONAL_DIGITS ||
                (autoFilledPhoneRef.current && !autoFilledPhoneRef.current.startsWith(nextPhone))
              );

            if (shouldClearAutoFilledName) {
              lastNameRef.current = '';
              autoFilledNameRef.current = '';
              autoFilledPhoneRef.current = '';
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
        {phoneComplete && (
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
