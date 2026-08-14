import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogAction, AlertDialogCancel
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2, Heart, Zap, Waves, Wind, Map } from 'lucide-react';
import { vo2maxTier } from '@/lib/cardioVO2max';
import { format, parseISO } from 'date-fns';
import { toast } from '@/lib/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { cardioTypeLabel } from '@/lib/cardioTypeLabel';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance, formatDuration, formatPace } from '@/lib/distanceUnit';
import { db } from '@/api/db';
import * as cardioData from '@/lib/data/cardio';
import { detectNewPRs, PR_LABELS } from '@/lib/cardioPRs';
import ErrorBoundary from '@/components/ErrorBoundary';

// RouteMap pulls in maplibre-gl (~200 KB gzipped). Most cardio rows
// have no GPS track, so eager-loading the whole map vendor for every
// cardio modal is wasteful. Lazy-load it: the map vendor chunk only
// fetches when a row WITH a track actually renders.
const RouteMap = lazy(() => import('./RouteMap'));

function DetailRow({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex justify-between items-start gap-4 py-1.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-end">{value}</span>
    </div>
  );
}

function haversineMeters(a, b) {
  const R = 6371000;
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const Δφ = (b.lat - a.lat) * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function computeSplits(track, unitMeters) {
  if (!track || track.length < 2) return [];
  const splits = [];
  let cumDist = 0;
  let lastSplitDist = 0;
  let lastSplitTime = track[0].timestamp_ms;
  
  for (let i = 1; i < track.length; i++) {
    cumDist += haversineMeters(track[i-1], track[i]);
    while (cumDist - lastSplitDist >= unitMeters) {
      // Interpolate the time at which cumulative distance hit (lastSplitDist + unitMeters)
      const fraction = (lastSplitDist + unitMeters - (cumDist - haversineMeters(track[i-1], track[i])))
                       / haversineMeters(track[i-1], track[i]);
      const splitEndTime = track[i-1].timestamp_ms
        + (track[i].timestamp_ms - track[i-1].timestamp_ms) * fraction;
      const splitSeconds = (splitEndTime - lastSplitTime) / 1000;
      splits.push({
        index: splits.length + 1,
        seconds: splitSeconds,
      });
      lastSplitDist += unitMeters;
      lastSplitTime = splitEndTime;
    }
  }
  
  // Trailing partial split (only show if > 30% of unit covered)
  const remaining = cumDist - lastSplitDist;
  if (remaining > unitMeters * 0.3) {
    const finalTime = track[track.length - 1].timestamp_ms;
    const partialSeconds = (finalTime - lastSplitTime) / 1000;
    splits.push({
      index: splits.length + 1,
      seconds: partialSeconds,
      partial: remaining / unitMeters,
    });
  }
  
  return splits;
}

export default function CardioDetailModal({ log: summary, open, onOpenChange, onEdit }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const { distanceUnit } = useDistanceUnit();
  const queryClient = useQueryClient();
  const [prsForThisLog, setPrsForThisLog] = useState([]);

  // This modal renders twenty-two columns — the GPS track for the route
  // map, calories, heart rate, cadence, power, pool length, laps, stroke,
  // route name, VO2max, notes. It used to get all of them for free because
  // CardioSavedList fetched `select('*')` for 500 rows and handed the row
  // object straight over, which meant every visit to Saved Workouts paid
  // for the route tracks of every session on the chance that one was
  // tapped. Fetching the full row HERE is what lets that list go lean.
  //
  // `summary` still renders immediately — it carries type, date, distance
  // and duration — so the modal opens instantly and fills in. On a failed
  // fetch it simply stays as the summary rather than blanking, which is
  // also what keeps this working for callers that pass a complete row.
  const [full, setFull] = useState(null);
  useEffect(() => {
    if (!open || !summary?.id) { setFull(null); return undefined; }
    let cancelled = false;
    cardioData.getById(summary.id).then((row) => { if (!cancelled && row) setFull(row); });
    return () => { cancelled = true; };
  }, [open, summary?.id]);

  const log = full || summary;

  useEffect(() => {
    if (!log?.id) return;
    let cancelled = false;
    (async () => {
      const all = await cardioData.listForPRs(user.email);
      if (cancelled) return;
      const prior = all.filter(l =>
        l.id !== log.id &&
        new Date(l.created_date || l.date) < new Date(log.created_date || log.date)
      );
      setPrsForThisLog(detectNewPRs(log, prior));
    })();
    return () => { cancelled = true; };
  }, [log?.id]);

  if (!log || !open) return null;

  const speedDisplay = log.avg_speed_kmh != null
    ? `${(distanceUnit === 'mi' ? log.avg_speed_kmh / 1.609344 : log.avg_speed_kmh).toFixed(1)} ${distanceUnit === 'mi' ? 'mph' : 'km/h'}`
    : null;

  const elevationDisplay = log.elevation_gain_m != null
    ? `${distanceUnit === 'mi' ? (log.elevation_gain_m / 0.3048).toFixed(0) : log.elevation_gain_m.toFixed(0)} ${distanceUnit === 'mi' ? 'ft' : 'm'}`
    : null;

  const handleDelete = async () => {
    await db.entities.CardioLog.delete(log.id);
    queryClient.invalidateQueries({ queryKey: ['cardioLogs', user?.email] });
    toast.success(t('cardio.deleted'));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {cardioTypeLabel(log.type, tFallback)}
          </DialogTitle>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="secondary" className="w-fit">
              {log.mode === 'live' ? t('cardio.input.live') : t('cardio.input.manual')}
            </Badge>
            {prsForThisLog.length > 0 && (
              prsForThisLog.map(pr => (
                <span key={pr.distance}
                      className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-medium">
                  🏆 {t('cardio.pr.badge').replace('{label}', PR_LABELS[pr.distance])}
                </span>
              ))
            )}
          </div>
        </DialogHeader>

        {log.gps_track && Array.isArray(log.gps_track) && log.gps_track.length > 1 && (
          <div className="mb-4">
            <p className="text-sm font-medium mb-2">{t('cardio.detail.routeMap')}</p>
            {/* ErrorBoundary so a maplibre/WebGL failure can't blank
                the whole cardio detail modal. */}
            <ErrorBoundary
              label="CardioDetailRouteMap"
              fallback={
                <div className="w-full h-60 rounded-lg bg-secondary/30 border border-border flex items-center justify-center text-xs text-muted-foreground">
                  {tFallback("cardioDetailModal.mapUnavailable", "Map unavailable")}
                </div>
              }
            >
              <Suspense fallback={<div className="w-full h-60 rounded-lg bg-secondary/50 animate-pulse" />}>
                <RouteMap track={log.gps_track} />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {log.gps_track && Array.isArray(log.gps_track) && log.gps_track.length === 0 && (
          <div className="mb-4 p-3 rounded-lg bg-muted text-center">
            <p className="text-sm text-muted-foreground">{t('cardio.detail.noRouteData')}</p>
          </div>
        )}

        {log.gps_track && log.gps_track.length >= 2 && (() => {
          const unit = distanceUnit === 'km' ? 1000 : 1609.344;
          const splits = computeSplits(log.gps_track, unit);
          if (splits.length === 0) return null;
          const fastest = splits.filter(s => !s.partial).reduce((min, s) =>
            (s.seconds < min ? s.seconds : min), Infinity);
          return (
            <div className="mt-4">
              <p className="text-sm font-medium mb-2">{t('cardio.detail.splits')}</p>
              <div className="space-y-1">
                <div className="flex text-xs text-muted-foreground px-2">
                  <span className="w-12">{t('cardio.detail.split')}</span>
                  <span className="flex-1">{t('cardio.detail.time')}</span>
                  <span className="flex-1 text-end">{t('cardio.detail.pace')}</span>
                </div>
                {splits.map(s => {
                  const isFastest = !s.partial && s.seconds === fastest;
                  const nonPartialSplits = splits.filter(x => !x.partial).map(x => x.seconds);
                  const slowest = nonPartialSplits.length > 0 ? Math.max(...nonPartialSplits) : s.seconds;
                  const barPct = slowest > 0 ? Math.min(100, (s.seconds / slowest) * 100) : 0;
                  return (
                    <div key={s.index} className={`flex items-center px-2 py-1.5 rounded-md ${
                      isFastest ? 'bg-primary/10' : 'bg-secondary/40'
                    }`}>
                      <span className="w-12 text-sm font-medium">
                        {s.index}{s.partial ? '*' : ''}
                      </span>
                      <span className="flex-1 text-sm">
                        {Math.floor(s.seconds / 60)}:{Math.round(s.seconds % 60).toString().padStart(2,'0')}
                      </span>
                      <div className="flex-1 flex items-center justify-end gap-2">
                        <div className="h-1 rounded-full bg-primary/40"
                             style={{ width: `${barPct * 0.6}%` }} />
                        {isFastest && <span className="text-xs">⚡</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        <div className="space-y-0 mt-2">
          <DetailRow
            label={t('cardio.field.date')}
            value={log.date ? format(parseISO(log.date), 'PPP') : null}
          />
          <DetailRow
            label={t('cardio.field.duration')}
            value={log.duration_seconds ? formatDuration(log.duration_seconds) : null}
          />
          <DetailRow
            label={t('cardio.field.distance')}
            value={log.distance_meters ? formatDistance(log.distance_meters, distanceUnit, 2) : null}
          />
          <DetailRow
            label={t('cardio.field.avgPace')}
            value={log.pace_seconds_per_km ? formatPace(log.pace_seconds_per_km, distanceUnit) : null}
          />
          <DetailRow
            label={t('cardio.field.avgSpeed')}
            value={speedDisplay}
          />
          <DetailRow
            label={t('cardio.field.calories')}
            value={log.calories ? `${log.calories} cal` : null}
          />
          <DetailRow
            label={t('cardio.field.incline')}
            value={log.incline_percent != null ? `${log.incline_percent}%` : null}
          />
          <DetailRow
            label={t('cardio.field.elevation')}
            value={elevationDisplay}
          />
          {/* New enhanced fields */}
          {log.avg_heart_rate && (
            <DetailRow
              label={<span className="flex items-center gap-1"><Heart className="w-3 h-3 text-rose-500" /> {tFallback("cardioDetailModal.avgHr", "Avg HR")}</span>}
              value={`${log.avg_heart_rate} bpm`}
            />
          )}
          {log.cadence_spm && (
            <DetailRow
              label={<span className="flex items-center gap-1"><Wind className="w-3 h-3 text-primary" /> {tFallback("cardioDetailModal.cadence", "Cadence")}</span>}
              value={`${log.cadence_spm} spm`}
            />
          )}
          {log.power_watts && (
            <DetailRow
              label={<span className="flex items-center gap-1"><Zap className="w-3 h-3 text-amber-500" /> {tFallback("cardioDetailModal.avgPower", "Avg Power")}</span>}
              value={`${log.power_watts} W`}
            />
          )}
          {log.pool_length_m && (
            <DetailRow
              label={<span className="flex items-center gap-1"><Waves className="w-3 h-3 text-blue-500" /> {tFallback("cardioManualForm.poolLength", "Pool Length")}</span>}
              value={`${log.pool_length_m} m`}
            />
          )}
          {log.laps && (
            <DetailRow label={tFallback('cardio.detail.laps', 'Laps')} value={`${log.laps} laps`} />
          )}
          {log.stroke_type && (
            <DetailRow label={tFallback('cardio.detail.stroke', 'Stroke')} value={log.stroke_type} />
          )}
          {log.route_name && (
            <DetailRow
              label={<span className="flex items-center gap-1"><Map className="w-3 h-3 text-green-500" /> {tFallback("cardioDetailModal.route", "Route")}</span>}
              value={log.route_name}
            />
          )}
          {log.vo2max_estimate && (() => {
            const tier = vo2maxTier(log.vo2max_estimate);
            return (
              <DetailRow
                label="VO₂max est."
                value={
                  <span className="flex items-center gap-1.5 justify-end">
                    <span>{log.vo2max_estimate} mL/kg/min</span>
                    {tier && <span className={`text-micro font-bold ${tier.color}`}>{tier.label}</span>}
                  </span>
                }
              />
            );
          })()}
        </div>

        {log.notes && (
          <p className="text-sm text-muted-foreground mt-2 pt-2 border-t border-border/50">
            {log.notes}
          </p>
        )}

        <DialogFooter className="flex-row gap-2 mt-4">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="flex-1">
                <Trash2 className="w-4 h-4 me-1" /> {t('common.delete')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('cardio.deleteConfirm')}</AlertDialogTitle>
                <AlertDialogDescription>{t('cardio.deleteConfirmDesc')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>{t('common.delete')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(log)}>
            <Pencil className="w-4 h-4 me-1" /> {t('common.edit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}