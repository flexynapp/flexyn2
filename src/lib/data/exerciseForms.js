// src/lib/data/exerciseForms.js
import { db } from '@/api/db';

export const list = () =>
  db.entities.ExerciseForm.list();

export const create = (data) => db.entities.ExerciseForm.create(data);
export const update = (id, data) => db.entities.ExerciseForm.update(id, data);
export const remove = (id) => db.entities.ExerciseForm.delete(id);