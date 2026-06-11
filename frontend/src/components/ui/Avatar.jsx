import React from 'react';
import PropTypes from 'prop-types';

const PALETTE = [
  'var(--accent-violet)',
  'var(--primary)',
  'var(--accent-teal)',
  'var(--accent-rose)',
  'var(--accent-amber)',
  'var(--accent-green)',
];

export function initialsOf(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function colorOf(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/**
 * Initials avatar with a deterministic per-name accent color.
 * Styles from `.avatar` / `.avatar-sm` in styles/chrome.css.
 *
 * @param {Object} props
 * @param {string} props.name
 * @param {'sm' | 'md'} [props.size]
 * @param {string} [props.className]
 */
export default function Avatar({ name, size = 'md', className = '' }) {
  const cls = size === 'sm' ? 'avatar-sm' : 'avatar';
  return (
    <span
      className={`${cls} ${className}`.trim()}
      style={size === 'sm' ? { background: colorOf(name) } : undefined}
      aria-hidden="true"
      title={name}
    >
      {initialsOf(name)}
    </span>
  );
}

Avatar.propTypes = {
  name: PropTypes.string.isRequired,
  size: PropTypes.oneOf(['sm', 'md']),
  className: PropTypes.string,
};
