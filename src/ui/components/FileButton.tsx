import type { ReactNode } from 'react';
import './FileButton.css';
import { Button } from './Button';

interface FileButtonProps {
  accept?: string;
  children: ReactNode;
  onFile: (file: File) => void;
}

/** Botão estilizado que aciona um input[type=file] nativo escondido por cima. */
export function FileButton({ accept, children, onFile }: FileButtonProps) {
  return (
    <span className="file-button">
      <Button variant="secondary" type="button">
        {children}
      </Button>
      <input
        className="file-button__input"
        type="file"
        accept={accept}
        aria-label={typeof children === 'string' ? children : undefined}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </span>
  );
}
