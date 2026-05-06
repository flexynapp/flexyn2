import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Dumbbell } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import RegimenForm from '@/components/regimens/RegimenForm';

export default function Regimens() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const queryClient = useQueryClient();

  const { data: regimens = [], isLoading } = useQuery({
    queryKey: ['regimens'],
    queryFn: () => base44.entities.Regimen.list('-created_date'),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Regimen.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regimens'] });
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Regimen.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regimens'] });
      setShowForm(false);
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Regimen.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['regimens'] }),
  });

  const handleSubmit = (data) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const openEdit = (regimen) => {
    setEditing(regimen);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight">Regimens</h1>
          <p className="text-muted-foreground mt-1">Your custom workout plans</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 mr-2" /> New Regimen
        </Button>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : regimens.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Dumbbell className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="font-heading text-lg font-semibold">No regimens yet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Create your first workout plan to get started</p>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> Create Regimen
          </Button>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {regimens.map(r => (
            <Card key={r.id} className="p-5 border-none shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-heading font-bold text-lg">{r.name}</h3>
                  {r.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.description}</p>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Regimen?</AlertDialogTitle>
                        <AlertDialogDescription>This will permanently delete "{r.name}". This can't be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(r.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.exercises?.map((ex, i) => (
                  <Badge key={i} variant="secondary" className="text-xs font-normal">
                    {ex.name}
                  </Badge>
                ))}
                {(!r.exercises || r.exercises.length === 0) && (
                  <span className="text-xs text-muted-foreground">No exercises added</span>
                )}
              </div>
              <div className="mt-3 pt-3 border-t border-border flex items-center text-xs text-muted-foreground">
                <Dumbbell className="w-3.5 h-3.5 mr-1" />
                {r.exercises?.length || 0} exercises
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={closeForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">
              {editing ? 'Edit Regimen' : 'New Regimen'}
            </DialogTitle>
          </DialogHeader>
          <RegimenForm initial={editing} onSubmit={handleSubmit} onCancel={closeForm} />
        </DialogContent>
      </Dialog>
    </div>
  );
}