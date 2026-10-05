import { useState } from 'react';
import { Field, Sheet } from '@/components';
import { useStore } from '@/store/store';
import { SheetForm } from './SheetForm';

/** The prototype's openForm('skill') sheet (lines 1905-1906) with its submit handler (line 2171). */
export function SkillForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Add a skill" description="Adds a skill to the list by name, so it can be assigned to agents. Its instructions live in a SKILL.md file in the skills folder of Meridian; that file is not written from here.">
      <SkillFields onClose={onClose} />
    </Sheet>
  );
}

function SkillFields({ onClose }: { onClose: () => void }) {
  const addSkill = useStore(s => s.addSkill);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState('');
  const submit = () => { const err = addSkill(name, desc); if (err) setMsg(err); else onClose(); };
  return (
    <SheetForm msg={msg} submitLabel="Save skill" onSubmit={submit} onCancel={onClose}>
      <Field label="Skill name" wide><input type="text" id="skName" required maxLength={40} placeholder="Schema markup" value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="When to use it" wide><input type="text" id="skDesc" required maxLength={120} placeholder="Creates and validates JSON-LD schema." value={desc} onChange={e => setDesc(e.target.value)} /></Field>
    </SheetForm>
  );
}
