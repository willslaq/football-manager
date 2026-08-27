import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import './TextField.css';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function TextField({ label, id, className, ...props }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? props.name ?? generatedId;
  return (
    <div className="field">
      {label && (
        <label className="field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input id={inputId} className={['field__input', className].filter(Boolean).join(' ')} {...props} />
    </div>
  );
}
