import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Footprints, PersonStanding, Bike, Activity, Waves, ChevronRight } from 'lucide-react';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance, formatDuration } from '@/lib/distanceUnit';

const titleCase = (str) => str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.07 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

function typeIcon(type) {
  if (type?.startsWith('running'))  return Footprints;
  if (type?.startsWith('walking'))  return PersonStanding;
  if (type?.startsWith('biking'))   return Bike;
  if (type?.startsWith('swimming')) return Waves;
  return Activity;
}

export default function CardioSavedList({ onSelectLog }) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { distanceUnit } = useDistanceUnit();
  const dateLocale = getDateLocale(language);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['cardioLogs', user?.email],
    queryFn: () => db.entities.CardioLog.filter(
      { created_by: user.email }, '-date', 50
    ),
    enabled: !!user?.email,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <Card className="p-8 border-dashed flex flex-col items-center gap-3 text-center">
        <Activity className="w-8 h-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('cardio.noSavedWorkouts')}</p>
      </Card>
    );
  }

  return (
    <motion.div
      className="space-y-3"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {logs.map(log => {
        const Icon = typeIcon(log.type);
        const subtitle = [
          log.date ? format(parseISO(log.date), 'MMM d', { locale: dateLocale }) : '',
          log.distance_meters ? formatDistance(log.distance_meters, distanceUnit, 2) : '',
          log.duration_seconds ? formatDuration(log.duration_seconds) : '',
        ].filter(Boolean).join(' • ');

        return (
          <motion.div key={log.id} variants={itemVariants}>
            <Card
              className="p-4 cursor-pointer hover:bg-secondary/40 transition-colors"
              onClick={() => onSelectLog(log)}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{titleCase(log.type.replace(/_/g, ' '))}</p>
                  <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </div>
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}