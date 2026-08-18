'use client';

import { useState, useCallback } from 'react';
import FieldEditor from './FieldEditor';
import type { TemplateField } from '@elogbook/shared';

interface FieldListProps {
  fields: TemplateField[];
  onChange: (fields: TemplateField[]) => void;
}

export default function FieldList({ fields, onChange }: FieldListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((index: number) => {
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      const newFields = [...fields];
      const [removed] = newFields.splice(dragIndex, 1);
      newFields.splice(dragOverIndex, 0, removed);
      const ordered = newFields.map((f, i) => ({ ...f, order: i }));
      onChange(ordered);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex, dragOverIndex, fields, onChange]);

  const handleUpdate = useCallback((index: number, field: TemplateField) => {
    const newFields = [...fields];
    newFields[index] = field;
    onChange(newFields);
  }, [fields, onChange]);

  const handleRemove = useCallback((index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  }, [fields, onChange]);

  const handleAdd = useCallback(() => {
    const newField: TemplateField = {
      key: `field_${Date.now()}`,
      label: '',
      type: 'text',
      required: false,
      order: fields.length,
    };
    onChange([...fields, newField]);
  }, [fields, onChange]);

  return (
    <div className="space-y-2">
      {fields.map((field, index) => (
        <FieldEditor
          key={field.key || index}
          field={field}
          index={index}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          isDragging={dragIndex === index}
        />
      ))}

      <button
        type="button"
        onClick={handleAdd}
        className="w-full p-3 rounded-lg border border-dashed border-border hover:border-primary/50 text-text-muted hover:text-primary text-sm transition-colors"
      >
        + Add Field
      </button>
    </div>
  );
}
