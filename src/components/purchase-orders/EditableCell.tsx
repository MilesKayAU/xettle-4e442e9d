import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Pencil } from 'lucide-react';

interface EditableCellProps {
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
  className?: string;
  isModified?: boolean;
}

export const EditableCell: React.FC<EditableCellProps> = ({
  value,
  onChange,
  prefix = '',
  suffix = '',
  className = '',
  isModified = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value.toString());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(value.toString());
  }, [value]);

  const handleBlur = () => {
    setIsEditing(false);
    const numValue = parseFloat(editValue) || 0;
    if (numValue !== value) {
      onChange(numValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
    } else if (e.key === 'Escape') {
      setEditValue(value.toString());
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="w-24 h-8 text-right"
        step="any"
      />
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className={cn(
        "group flex items-center justify-end gap-1 px-2 py-1 rounded hover:bg-muted/50 transition-colors cursor-pointer",
        isModified && "text-primary font-semibold",
        className
      )}
      title="Click to edit"
    >
      <span>
        {prefix}{value.toLocaleString(undefined, { minimumFractionDigits: prefix === '$' ? 2 : 0, maximumFractionDigits: 2 })}{suffix}
      </span>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
    </button>
  );
};
