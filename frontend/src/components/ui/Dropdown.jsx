import React, { useEffect, useId, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Check } from 'lucide-react';

/**
 * Anchored dropdown menu. The trigger is render-prop'd so any element can
 * open it; items render in a `.menu` popover (styles/chrome.css).
 *
 * @param {Object} props
 * @param {(args: { open: boolean, toggle: () => void, triggerProps: Object }) => React.ReactNode} props.renderTrigger
 * @param {Array<{ id: string, label: React.ReactNode, icon?: React.ElementType, danger?: boolean, checked?: boolean, separatorAbove?: boolean, onSelect?: () => void }>} props.items
 * @param {React.ReactNode} [props.header] - Optional `.menu-label` heading.
 * @param {boolean} [props.alignRight]
 * @param {string} [props.className]
 */
export default function Dropdown({
  renderTrigger,
  items,
  header,
  alignRight = true,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const handlePointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const menuItems = Array.from(rootRef.current?.querySelectorAll('[role="menuitem"]') || []);
        if (menuItems.length === 0) return;
        event.preventDefault();
        const index = menuItems.indexOf(document.activeElement);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = menuItems[(index + delta + menuItems.length) % menuItems.length];
        next.focus();
      }
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const toggle = () => setOpen((value) => !value);

  return (
    <div ref={rootRef} className={`popover-anchor ${className}`.trim()}>
      {renderTrigger({
        open,
        toggle,
        triggerProps: {
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-controls': open ? menuId : undefined,
        },
      })}
      {open && (
        <div className={`popover ${alignRight ? 'right' : ''}`.trim()}>
          <div className="menu" role="menu" id={menuId}>
            {header && <div className="menu-label">{header}</div>}
            {items.map((item) => (
              <React.Fragment key={item.id}>
                {item.separatorAbove && <div className="menu-sep" role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  className={`menu-item ${item.danger ? 'danger' : ''}`.trim()}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect?.();
                  }}
                >
                  {item.icon && <item.icon size={15} aria-hidden="true" />}
                  {item.label}
                  {item.checked && <Check size={15} className="mi-check" aria-hidden="true" />}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

Dropdown.propTypes = {
  renderTrigger: PropTypes.func.isRequired,
  items: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.node.isRequired,
      icon: PropTypes.elementType,
      danger: PropTypes.bool,
      checked: PropTypes.bool,
      separatorAbove: PropTypes.bool,
      onSelect: PropTypes.func,
    })
  ).isRequired,
  header: PropTypes.node,
  alignRight: PropTypes.bool,
  className: PropTypes.string,
};
