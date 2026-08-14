// src/components/cardio/CardioTemplates.jsx
//
// Saved cardio quick-start templates. Users save a template from
// CardioManualForm via "Save as Template". Here they can list, apply
// (pre-fills the manual form), or delete their templates.
//
// Tapping a template calls onApply(template) — CardioSection handles
// routing to manualEntry with the template values pre-loaded.

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Footprints, PersonStanding, Bike, Activity, Waves, ChevronRight, Trash2, BookOpen } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance, formatDuration } from '@/lib/distanceUnit';
import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';
import { useLanguage } from '@/lib/LanguageContext';

function typeIcon(type = '') {
  if (type.startsWith('running'))  return Footprints;
  if (type.startsWith('walking'))  return PersonStanding;
  if (type.startsWith('biking'))   return Bike;
  if (type.startsWith('swimming')) return Waves;
  return Activity;
}

function typeColor(type = '') {
  if (type.startsWith('running'))  return 'bg-orange-500/10 text-orange-500';
  if (type.startsWith('walking'))  return 'bg-green-500/10 text-green-500';
  if (type.startsWith('biking'))   return 'bg-blue-500/10 text-blue-500';
  if (type.startsWith('swimming')) return 'bg-cyan-500/10 text-cyan-500';
  return 'bg-primary/10 text-primary';
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
  exit:   { opacity: 0, x: -20 },
};

export default function CardioTemplates({ onApply }) {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const { distanceUnit } = useDistanceUnit();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['cardioTemplates', user?.email],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cardio_templates')
        .select('*')
        .eq('created_by', user.email)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  const handleDelete = async (tpl) => {
    setDeleting(tpl.id);
    try {
      const { error } = await supabase
        .from('cardio_templates')
        .delete()
        .eq('id', tpl.id)
        .eq('created_by', user.email);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['cardioTemplates', user?.email] });
      toast.success(`Template "${tpl.name}" deleted`);
    } catch (err) {
      reportError(err, { feature: 'cardio.template.delete' });
      toast.error(tFallback("cardioTemplates.failedToDeleteTemplate", "Failed to delete template"));
    } finally {
      setDeleting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <Card className="p-8 border-dashed flex flex-col items-center gap-3 text-center">
        <BookOpen className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-sm font-semibold text-muted-foreground">{tFallback("workout.templates.noTemplates", "No templates yet")}</p>
        <p className="text-xs text-muted-foreground/70 max-w-[200px]">
          Log a cardio session and tap "Save as Template" to store your go-to workouts here.
        </p>
      </Card>
    );
  }

  return (
    <motion.div
      // `flex flex-col gap-3`, not `space-y-3` — same 12px, different
      // mechanism, and the mechanism matters below. space-y puts a
      // margin-top on every child after the first; popLayout pins an
      // exiting child with `top: <its offsetTop>`, and offsetTop ALREADY
      // includes that margin, so the margin gets applied twice and the
      // card drops 12px the instant it starts to leave. `gap` is the
      // parent's, not the child's, so it can't double-count.
      className="flex flex-col gap-3"
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
    >
      {/* Deleting a template used to leave its card holding a full-height
          slot while it slid away, and only then did the cards below jump up
          to close the gap. popLayout drops it out of flow on the first
          frame so they glide instead. */}
      <AnimatePresence mode="popLayout">
        {templates.map(tpl => {
          const Icon = typeIcon(tpl.type);
          const iconClass = typeColor(tpl.type);
          const subtitle = [
            tpl.distance_meters ? formatDistance(tpl.distance_meters, distanceUnit, 2) : null,
            tpl.duration_seconds ? formatDuration(tpl.duration_seconds) : null,
            tpl.stroke_type || null,
          ].filter(Boolean).join(' · ');

          return (
            <motion.div
              key={tpl.id}
              variants={itemVariants}
              exit="exit"
              // A template card's height is fixed by its content and does
              // not change when the list refilters; only where it sits does.
              layout="position"
            >
              <Card className="overflow-hidden">
                <div className="flex items-center">
                  {/* Tap to apply */}
                  <button
                    className="flex-1 flex items-center gap-3 p-4 text-start hover:bg-secondary/40 active:bg-secondary/40 transition-colors"
                    onClick={() => onApply(tpl)}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{tpl.name}</p>
                      {subtitle && (
                        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                      )}
                      {tpl.notes && (
                        <p className="text-xs text-muted-foreground/60 truncate mt-0.5 italic">{tpl.notes}</p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>

                  {/* Delete */}
                  <button
                    className="px-3 py-4 text-muted-foreground hover:text-destructive active:text-destructive transition-colors shrink-0"
                    onClick={() => handleDelete(tpl)}
                    disabled={deleting === tpl.id}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
}
