import React, { useState, useRef, useEffect, useMemo } from 'react';
import { filterAfterReset } from '@/lib/accountReset';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import * as nutritionData from '@/lib/data/nutrition';
import { useAuth } from '@/lib/AuthContext';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { XP_REWARDS } from '@/lib/xpSystem';
import { toast } from 'sonner';
import { Plus, Barcode, Trash2, TrendingUp, Loader2, Droplet, X, Beaker, Settings as SettingsIcon, History } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MacroNutrientBox from '@/components/nutrition/MacroNutrientBox';
import MineralsVitaminsBox from '@/components/nutrition/MineralsVitaminsBox';
import WaterTracker from '@/components/nutrition/WaterTracker';
import BarcodeResultModal from '@/components/nutrition/BarcodeResultModal';
import BarcodeNotFoundModal from '@/components/nutrition/BarcodeNotFoundModal';
import LogMealForm from '@/components/nutrition/LogMealForm';
import NutritionOnboardingModal from '@/components/nutrition/NutritionOnboardingModal';
import MealHistoryModal from '@/components/nutrition/MealHistoryModal';
import NutritionPlansModal from '@/components/nutrition/NutritionPlansModal';
import { lookupBarcode } from '@/lib/foodLookup';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { useLanguage } from '@/lib/LanguageContext';
import { useLocation } from 'react-router-dom';

export default function Nutrition() {
  const { t, tFallback } = useLanguage();
  const location = useLocation();

  const [openLogMeal, setOpenLogMeal] = useState(false);

  useEffect(() => {
    if (!location?.state?.openLogMeal) return;
    setOpenLogMeal(true);
    window.history.replaceState({}, document.title);
    // Scroll to the form after a tick so the animation has started
    setTimeout(() => {
      const el = document.getElementById('log-meal-form');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, [location?.state?.openLogMeal]);
  // Date is always today's local date — Nutrition no longer supports past-day viewing.
  const date = format(new Date(), 'yyyy-MM-dd');
  const [showScanner, setShowScanner] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('idle');
  const [scannerError, setScannerError] = useState(null);
  const [scannedProduct, setScannedProduct] = useState(null);
  const [notFoundBarcode, setNotFoundBarcode] = useState(null);
  const [showNutritionPlans, setShowNutritionPlans] = useState(false);
  const [showMealHistory, setShowMealHistory] = useState(false);

  // Hard daily cap: 200 oz (~5.9L). Beyond this is water-toxicity territory.
  const WATER_DAILY_CAP_OZ = 200;
  const [nutritionTab, setNutritionTab] = useState('macros');
  const [entries, setEntries] = useState([]);
  // waterOz is derived from persisted logs
  const [waterUnit, setWaterUnit] = useState('oz');
  const [customBottles, setCustomBottles] = useState([]);
  const [newEntry, setNewEntry] = useState({
    food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '',
    sodium_mg: '', fiber_g: '', sugar_g: '', cholesterol_mg: '',
    iron_mg: '', magnesium_mg: '', calcium_mg: '', potassium_mg: '',
    vitamin_a_iu: '', vitamin_c_mg: '', vitamin_d_iu: '', vitamin_b12_mcg: ''
  });
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);
  const lastBarcodeRef = useRef(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: userProfile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email
  });

  const [showGoalsOnboarding, setShowGoalsOnboarding] = useState(false);
  const [goalsModalManuallyOpened, setGoalsModalManuallyOpened] = useState(false);

  // Auto-open onboarding the first time the user lands on the Nutrition page,
  // but only after the user profile has loaded so we don't flash the modal at
  // users who already onboarded.
  useEffect(() => {
    if (!user?.email) return;
    if (userProfile && Object.keys(userProfile).length === 0) return; // still loading
    const localDone = (() => { try { return localStorage.getItem('fn-nutrition-onboarded') === 'true'; } catch { return false; } })();
    if (userProfile?.nutrition_onboarding_complete || localDone) return;
    if (goalsModalManuallyOpened) return;
    setShowGoalsOnboarding(true);
  }, [user?.email, userProfile?.nutrition_onboarding_complete, goalsModalManuallyOpened]);

  const handleOnboardingComplete = () => {
    setShowGoalsOnboarding(false);
    setGoalsModalManuallyOpened(false);
    queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
  };

  const openGoalsEditor = () => {
    setGoalsModalManuallyOpened(true);
    setShowGoalsOnboarding(true);
  };

  const { data: rawLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['nutritionLogs', user?.email, date],
    queryFn: () => db.entities.NutritionLog.filter({ created_by: user.email, date }),
    enabled: !!user?.email
  });
  // Also wait for the profile so macro goals render correctly on first paint
  const isLoading = logsLoading || (!!user?.email && Object.keys(userProfile).length === 0);

  const logs = useMemo(() => filterAfterReset(rawLogs, userProfile), [rawLogs, userProfile]);

  // Derive water data from logs
  const waterEntries = logs.filter(e => e.food_name === 'Water' && e.water_oz > 0);
  const waterOz = waterEntries.reduce((sum, e) => sum + (e.water_oz || 0), 0);

  // Always sync — ensures carousel clears on delete and updates after refetch
  useEffect(() => {
    setEntries(logs);
  }, [logs]);

  const saveMutation = useMutation({
    mutationFn: (data) => nutritionData.create(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['nutritionLogs', user?.email, date] });
      if (variables.water_oz > 0) {
        // XP value comes from XP_REWARDS.waterGlass (single source of truth).
        // Was hardcoded to 1 inline, drifted from the documented 3.
        const xpForWater = (XP_REWARDS && XP_REWARDS.waterGlass) || 3;
        db.functions.invoke('updateUserXpAndAchievements', {
          xp_gained: xpForWater,
          action_type: 'water_logged',
          action_data: { date, oz: variables.water_oz },
        }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        toast.success(t('nutrition.toast.waterLogged'));
        // Quest progress — count one quest "tick" per logged glass entry
        quests.recordAction(user, ACTION_TYPES.WATER_LOGGED, 1)
          .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
          .catch(() => {});
      } else {
        setNewEntry({ food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '', sodium_mg: '', fiber_g: '', sugar_g: '', cholesterol_mg: '', iron_mg: '', magnesium_mg: '', calcium_mg: '', potassium_mg: '', vitamin_a_iu: '', vitamin_c_mg: '', vitamin_d_iu: '', vitamin_b12_mcg: '' });
        toast.success(t('nutrition.toast.mealLogged'));
        quests.recordAction(user, ACTION_TYPES.MEAL_LOGGED, 1)
          .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
          .catch(() => {});
      }
    },
    onError: (err) => {
      console.error('[Nutrition] save failed:', err);
      toast.error(t('nutrition.toast.saveError'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => nutritionData.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutritionLogs', user?.email, date] });
      toast.success(t('nutrition.toast.entryRemoved'));
    },
    onError: (err) => {
      console.error('[Nutrition] delete failed:', err);
      toast.error(t('nutrition.toast.deleteError'));
    },
  });

  /* =========================================================
     BARCODE SCANNER
     ========================================================= */

  const startScanner = async () => {
    setShowScanner(true);
    setScannerError(null);
    setScannerStatus('initializing');
    lastBarcodeRef.current = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Your browser does not support camera access.');
      }
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      if (devices.length === 0) throw new Error('No camera found on this device.');
      const rearCamera = devices.find((d) => /back|rear|environment/i.test(d.label));
      const deviceId = rearCamera?.deviceId || devices[0].deviceId;

      readerRef.current = new BrowserMultiFormatReader();
      setScannerStatus('scanning');

      controlsRef.current = await readerRef.current.decodeFromVideoDevice(
        deviceId,
        videoRef.current,
        async (result) => {
          if (!result) return;
          const barcode = result.getText();
          if (barcode === lastBarcodeRef.current) return;
          lastBarcodeRef.current = barcode;
          setScannerStatus('looking-up');
          controlsRef.current?.stop();
          await lookupAndShow(barcode);
        }
      );
    } catch (e) {
      setScannerError(parseCameraError(e, t));
      setScannerStatus('error');
    }
  };

  const lookupAndShow = async (barcode) => {
    try {
      const product = await lookupBarcode(barcode);
      if (!product) {
        // No match across all three sources — show the community submission form
        stopScanner();
        setNotFoundBarcode(barcode);
        return;
      }
      stopScanner();
      setScannedProduct(product);
    } catch (e) {
      setScannerError(`Lookup failed: ${e.message}. Check your connection and try again.`);
      setScannerStatus('error');
    }
  };

  const stopScanner = () => {
    try { controlsRef.current?.stop(); } catch {}
    controlsRef.current = null;
    readerRef.current = null;
    lastBarcodeRef.current = null;
    setScannerStatus('idle');
    setScannerError(null);
    setShowScanner(false);
  };

  const retryScanner = () => {
    setScannerError(null);
    lastBarcodeRef.current = null;
    startScanner();
  };

  useEffect(() => {
    return () => { try { controlsRef.current?.stop(); } catch {} };
  }, []);

  /* ========================================================= */

  const handleLogScannedProduct = () => {
    if (!scannedProduct) return;
    const n = scannedProduct.nutrition;
    const v = scannedProduct.vitamins || {};
    saveMutation.mutate({
      date,
      food_name: scannedProduct.name,
      calories:       n.calories ?? 0,
      protein_g:      n.protein  ?? 0,
      carbs_g:        n.carbs    ?? 0,
      fat_g:          n.fat      ?? 0,
      fiber_g:        n.fiber    ?? null,
      sugar_g:        n.sugar    ?? null,
      sodium_mg:      n.sodium   ?? null,
      cholesterol_mg: n.cholesterol ?? null,
      // Vitamins & minerals — now populated from USDA/community sources
      calcium_mg:      v.calcium_mg     ?? null,
      iron_mg:         v.iron_mg        ?? null,
      magnesium_mg:    v.magnesium_mg   ?? null,
      potassium_mg:    v.potassium_mg   ?? null,
      vitamin_a_iu:    v.vitamin_a_iu   ?? null,
      vitamin_c_mg:    v.vitamin_c_mg   ?? null,
      vitamin_d_iu:    v.vitamin_d_iu   ?? null,
      vitamin_b12_mcg: v.vitamin_b12_mcg ?? null,
      meal_type: 'snack',
    });
    setScannedProduct(null);
  };

  const addEntry = () => {
    if (!newEntry.food_name.trim()) { toast.error(t('nutrition.toast.enterFoodName')); return; }
    saveMutation.mutate({
      date,
      ...Object.fromEntries(Object.entries(newEntry).map(([k, v]) => [k, v === '' ? 0 : v]))
    });
    setNewEntry({ food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '', sodium_mg: '', fiber_g: '', sugar_g: '', cholesterol_mg: '', iron_mg: '', magnesium_mg: '', calcium_mg: '', potassium_mg: '', vitamin_a_iu: '', vitamin_c_mg: '', vitamin_d_iu: '', vitamin_b12_mcg: '' });
  };

  const ozToDisplay = (oz) => {
    if (waterUnit === 'ml') return Math.round(oz * 29.5735);
    if (waterUnit === 'L') return parseFloat((oz * 0.0295735).toFixed(2));
    return oz;
  };

  const displayToOz = (amount, unit) => {
    if (unit === 'ml') return amount / 29.5735;
    if (unit === 'L') return amount * 33.814;
    return amount;
  };

  const unitLabel = waterUnit;

  const [showBottleModal, setShowBottleModal] = useState(false);
  const [bottleInput, setBottleInput] = useState('');
  const [bottleInputUnit, setBottleInputUnit] = useState('oz');

  // Largest commercial bottle: 5-gallon jug = 640 oz
  const MAX_BOTTLE_OZ = 640;

  const maxBottleInUnit = (unit) => {
    if (unit === 'ml') return `${Math.round(MAX_BOTTLE_OZ * 29.5735).toLocaleString()} ml`;
    if (unit === 'L')  return `${(MAX_BOTTLE_OZ * 0.0295735).toFixed(1)} L`;
    return `${MAX_BOTTLE_OZ} oz`;
  };

  const handleSaveBottle = () => {
    const amount = Number(bottleInput);
    if (isNaN(amount) || amount <= 0) {
      toast.error(t('nutrition.toast.positiveNumber'));
      return;
    }
    const convertedOz = displayToOz(amount, bottleInputUnit);
    if (convertedOz > MAX_BOTTLE_OZ) {
      toast.error(`Max bottle size is ${maxBottleInUnit(bottleInputUnit)} (5-gallon jug).`);
      return;
    }
    setCustomBottles([...customBottles, {
      id: Date.now().toString(),
      label: `${bottleInput} ${bottleInputUnit}`,
      oz: convertedOz,
      displayAmount: amount,
      displayUnit: bottleInputUnit
    }]);
    setShowBottleModal(false);
    setBottleInput('');
  };

  const handleDeleteBottle = (id) => {
    setCustomBottles(customBottles.filter(b => b.id !== id));
  };

  const getGlassLabel = () => {
    const oz = 8;
    if (waterUnit === 'ml') return `+ Glass (${Math.round(oz * 29.5735)} ml)`;
    if (waterUnit === 'L') return `+ Glass (${(oz * 0.0295735).toFixed(2)} L)`;
    return '+ Glass (8 oz)';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="p-4 md:p-8 max-w-4xl mx-auto">

      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-8">
        <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight">{t('nutrition.title')}</h1>
        <p className="text-muted-foreground mt-1">{t('nutrition.subtitle')}</p>
      </motion.div>

      <div className="mb-6">
        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('workout.date')}</label>
        <p className="font-heading text-lg font-semibold tracking-tight">
          {format(new Date(), 'EEEE, MMMM d')}
        </p>
      </div>

      {/* Loading skeleton — shown while logs + profile are fetching on first render */}
      {isLoading && (
        <div className="space-y-4 mb-6">
          <div className="flex gap-3">
            <Skeleton className="h-28 flex-1 rounded-xl" />
            <Skeleton className="h-28 flex-1 rounded-xl" />
            <Skeleton className="h-28 flex-1 rounded-xl" />
          </div>
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      )}

      {/* Barcode scanner modal */}
      {showScanner && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-4">
            <h3 className="font-heading font-bold mb-4">{t('nutrition.scanBarcode')}</h3>
            <div className="relative w-full aspect-square rounded-lg mb-4 bg-black overflow-hidden">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-3/4 h-1/3 relative">
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-primary" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-primary" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-primary" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-primary" />
                </div>
              </div>
              {(scannerStatus === 'initializing' || scannerStatus === 'looking-up') && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-white text-sm">
                    {scannerStatus === 'initializing' ? t('nutrition.startingCamera') : t('nutrition.fetchingNutrition')}
                  </p>
                </div>
              )}
            </div>
            {scannerStatus === 'scanning' && (
              <p className="text-xs text-muted-foreground text-center mb-3">{t('nutrition.pointCamera')}</p>
            )}
            {scannerStatus === 'error' && scannerError && (
              <div className="mb-3 p-3 rounded-md bg-destructive/10 border border-destructive/30">
                <p className="text-sm text-destructive">{scannerError}</p>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={stopScanner} className="flex-1">{t('nutrition.close')}</Button>
              {scannerStatus === 'error' && (
                <Button onClick={retryScanner} className="flex-1">{t('nutrition.tryAgain')}</Button>
              )}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Scan result modal */}
      {scannedProduct && (
        <BarcodeResultModal
          product={scannedProduct}
          onCancel={() => setScannedProduct(null)}
          onLog={handleLogScannedProduct}
          isLogging={saveMutation.isPending}
        />
      )}

      {/* Not found modal — community submission form */}
      {notFoundBarcode && (
        <BarcodeNotFoundModal
          barcode={notFoundBarcode}
          onCancel={() => setNotFoundBarcode(null)}
          onSubmit={(product) => {
            setNotFoundBarcode(null);
            setScannedProduct(product);  // immediately show the result modal for logging
          }}
        />
      )}

      {/* Nutrition Tabs */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="mb-6">
        <div className="flex gap-1 p-1 bg-secondary rounded-lg mb-4 border border-border">
          {[
            { id: 'macros', label: t('nutrition.nutritionalValues') },
            { id: 'vitamins', label: t('nutrition.vitaminsAndMinerals') },
          ].map(tab => (
            <motion.button
              key={tab.id}
              onClick={() => setNutritionTab(tab.id)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${nutritionTab === tab.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            >
              {tab.label}
            </motion.button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          {nutritionTab === 'macros' ? (
            <motion.div key="macros" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, pointerEvents: 'none' }} transition={{ duration: 0.2 }}>
              <MacroNutrientBox entries={entries} userProfile={userProfile} />
            </motion.div>
          ) : (
            <motion.div key="vitamins" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, pointerEvents: 'none' }} transition={{ duration: 0.2 }}>
              <MineralsVitaminsBox entries={entries} userProfile={userProfile} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Nutrition Goals & Plans */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }} className="mb-6 grid grid-cols-3 gap-2">
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} transition={{ type: 'spring', stiffness: 380, damping: 20 }}>
          <Button onClick={openGoalsEditor} variant="outline" className="w-full h-12 font-heading font-semibold text-xs md:text-sm">
            <SettingsIcon className="w-4 h-4 mr-1.5 shrink-0" />
            <span className="truncate">{t('nutrition.editGoals')}</span>
          </Button>
        </motion.div>
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} transition={{ type: 'spring', stiffness: 380, damping: 20 }}>
          <Button onClick={() => setShowMealHistory(true)} variant="outline" className="w-full h-12 font-heading font-semibold text-xs md:text-sm">
            <History className="w-4 h-4 mr-1.5 shrink-0" />
            <span className="truncate">Meal History</span>
          </Button>
        </motion.div>
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} transition={{ type: 'spring', stiffness: 380, damping: 20 }}>
          <Button onClick={() => setShowNutritionPlans(true)} variant="outline" className="w-full h-12 font-heading font-semibold text-xs md:text-sm">
            <span className="mr-1">📋</span>
            <span className="truncate">{t('nutrition.nutritionPlans')}</span>
          </Button>
        </motion.div>
      </motion.div>

      {/* Log Meal Form */}
      <motion.div
        id="log-meal-form"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="mb-6 scroll-mt-24"
      >
        <LogMealForm
          newEntry={newEntry}
          setNewEntry={setNewEntry}
          onScan={startScanner}
          onLog={addEntry}
          isScanning={showScanner}
          isLogging={saveMutation.isPending}
          defaultOpen={openLogMeal}
        />
      </motion.div>

      {/* Water Tracker */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.35 }} className="mb-6">
        <Card className="p-6 border-none shadow-sm">
          <div className="space-y-4">
            {/* HEADER ROW */}
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">{t('nutrition.waterIntake')}</h3>
              {/* Unit Toggle — radio-style group; aria-pressed lets screen
                  readers announce active vs inactive state. */}
              <div role="group" aria-label={t('nutrition.waterIntake')} className="flex rounded-lg border border-border overflow-hidden bg-secondary/30">
                {['oz', 'ml', 'L'].map(unit => (
                  <button
                    key={unit}
                    onClick={() => setWaterUnit(unit)}
                    aria-pressed={waterUnit === unit}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      waterUnit === unit
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>

            {/* WATERTRACKER */}
            <WaterTracker waterOz={waterOz} userProfile={userProfile} waterUnit={waterUnit} ozToDisplay={ozToDisplay} />

            {/* BUTTON ROW */}
            <div className="flex flex-wrap gap-2 pt-2">
              {/* Add Glass Button */}
              <Button
                className="text-xs md:text-sm"
                onClick={() => {
                  if (waterOz + 8 > WATER_DAILY_CAP_OZ) {
                    toast.error(`Daily water limit reached (${ozToDisplay(WATER_DAILY_CAP_OZ)} ${waterUnit}). Stay safe!`);
                    return;
                  }
                  saveMutation.mutate({ date, food_name: 'Water', water_oz: 8, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
                }}
                disabled={saveMutation.isPending || waterOz + 8 > WATER_DAILY_CAP_OZ}
              >
                <Droplet className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">{getGlassLabel()}</span><span className="sm:hidden">Glass (8 oz)</span>
              </Button>

              {/* Custom Bottle Buttons */}
              {customBottles.map(bottle => (
                <motion.div
                  key={bottle.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="relative"
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (waterOz + bottle.oz > WATER_DAILY_CAP_OZ) {
                        toast.error(`Daily water limit reached (${ozToDisplay(WATER_DAILY_CAP_OZ)} ${waterUnit}). Stay safe!`);
                        return;
                      }
                      saveMutation.mutate({ date, food_name: 'Water', water_oz: bottle.oz, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
                    }}
                    disabled={saveMutation.isPending || waterOz + bottle.oz > WATER_DAILY_CAP_OZ}
                    className="pr-8 text-xs"
                  >
                    🍶 {bottle.label}
                  </Button>
                  <button
                    onClick={() => handleDeleteBottle(bottle.id)}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs hover:bg-destructive/90"
                  >
                    ×
                  </button>
                </motion.div>
              ))}

              {/* Add Custom Bottle Button */}
              <Button
                variant="outline"
                className="border-dashed text-xs md:text-sm"
                onClick={() => setShowBottleModal(true)}
              >
                <Beaker className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">{t('nutrition.customBottle')}</span><span className="sm:hidden">Bottle</span>
              </Button>
            </div>

            {/* WATER ENTRY LOG — grouped by size */}
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-muted-foreground">{t('nutrition.waterEntries')}</p>
              </div>
              {waterEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('nutrition.noWater')}</p>
              ) : (
                <WaterEntryGroups
                  entries={waterEntries}
                  ozToDisplay={ozToDisplay}
                  waterUnit={waterUnit}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              )}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Custom Bottle Modal */}
      <Dialog open={showBottleModal} onOpenChange={setShowBottleModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('nutrition.addCustomBottle')}</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">{t('nutrition.bottleSize')}</p>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="bottle-amount" className="text-sm font-medium mb-2 block">{t('nutrition.amount')}</label>
              <Input
                id="bottle-amount"
                type="number"
                min="1"
                max={bottleInputUnit === 'ml' ? Math.round(MAX_BOTTLE_OZ * 29.5735) : bottleInputUnit === 'L' ? (MAX_BOTTLE_OZ * 0.0295735).toFixed(1) : MAX_BOTTLE_OZ}
                placeholder="e.g. 32"
                value={bottleInput}
                onChange={e => setBottleInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">Max: {maxBottleInUnit(bottleInputUnit)}</p>
            </div>
            <div>
              <span id="bottle-unit-label" className="text-sm font-medium mb-2 block">{t('nutrition.unit')}</span>
              <div
                role="group"
                aria-labelledby="bottle-unit-label"
                className="flex rounded-lg border border-border overflow-hidden bg-secondary/30"
              >
                {['oz', 'ml', 'L'].map(unit => (
                  <button
                    key={unit}
                    onClick={() => setBottleInputUnit(unit)}
                    aria-pressed={bottleInputUnit === unit}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      bottleInputUnit === unit
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-4">
              <Button variant="outline" onClick={() => setShowBottleModal(false)} className="flex-1">
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSaveBottle} className="flex-1">
                {t('nutrition.saveBottle')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Entries list */}
      <motion.div className="space-y-2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }}>
        <h3 className="font-heading font-bold mb-4">{t('nutrition.todaysMeals')}</h3>
        <AnimatePresence>
          {entries.filter(entry => !(entry.food_name === 'Water' && entry.water_oz > 0)).length === 0 ? (
            <Card className="p-8 text-center border-dashed">
              <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="font-heading font-semibold">{t('nutrition.noMeals')}</p>
              <p className="text-sm text-muted-foreground mt-1">{t('nutrition.noMealsDesc')}</p>
            </Card>
          ) : (
            entries.filter(entry => !(entry.food_name === 'Water' && entry.water_oz > 0)).map((entry) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 100, height: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                whileHover={{ scale: 1.02, y: -1 }}
                style={{ overflow: 'hidden' }}>
                <Card className="p-4 border-none shadow-sm flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium">{entry.food_name}</p>
                    <p className="text-sm text-muted-foreground space-x-2">
                      <span>{entry.calories} kcal</span>
                      {entry.protein_g > 0 && <span>• P: {entry.protein_g}g</span>}
                      {entry.carbs_g > 0 && <span>• C: {entry.carbs_g}g</span>}
                      {entry.fat_g > 0 && <span>• F: {entry.fat_g}g</span>}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tFallback ? tFallback('nutrition.deleteEntry', 'Delete entry') : 'Delete entry'}
                    onClick={() => deleteMutation.mutate(entry.id)}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" aria-hidden="true" />
                  </Button>
                </Card>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </motion.div>

      {/* Meal History Modal */}
      <MealHistoryModal
        open={showMealHistory}
        onClose={() => setShowMealHistory(false)}
        userProfile={userProfile}
      />

      {/* Nutrition Goals Onboarding */}
      <NutritionOnboardingModal
        open={showGoalsOnboarding}
        userProfile={userProfile}
        onComplete={handleOnboardingComplete}
      />

      {/* Nutrition Plans Modal */}
      <NutritionPlansModal
        open={showNutritionPlans}
        onClose={() => setShowNutritionPlans(false)}
        userProfile={userProfile}
      />
    </motion.div>
  );
}



/* ── Grouped water entries ──────────────────────────────────────────────── */
function WaterEntryGroups({ entries, ozToDisplay, waterUnit, onDelete }) {
  // Group entries by their oz value so identical glasses collapse
  const groups = React.useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      const key = e.water_oz;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    return Array.from(map.entries()).map(([oz, items]) => ({
      oz,
      label: `${ozToDisplay(oz)} ${waterUnit}`,
      count: items.length,
      ids: items.map(i => i.id),
      latestId: items[items.length - 1].id,
    }));
  }, [entries, ozToDisplay, waterUnit]);

  return (
    <div className="flex flex-wrap gap-2">
      {groups.map(g => (
        <motion.div
          key={g.oz}
          layout
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs"
        >
          <Droplet className="w-3 h-3 text-blue-500 shrink-0" />
          <span className="font-medium text-blue-700 dark:text-blue-300">{g.label}</span>
          {g.count > 1 && (
            <span className="font-heading font-bold text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400">
              ×{g.count}
            </span>
          )}
          <button
            onClick={() => onDelete(g.latestId)}
            className="ml-0.5 p-0.5 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Remove one"
            aria-label={`Remove one ${g.label}`}
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        </motion.div>
      ))}
    </div>
  );
}

function parseCameraError(err, t) {
  const msg = err?.message || String(err);
  if (/permission|notallowed|denied/i.test(msg)) return t('formcoach.cameraAccessDenied');
  if (/notfound|devices/i.test(msg)) return t('formcoach.noCameraFound');
  if (/notreadable|inuse/i.test(msg)) return t('formcoach.noCameraSupport');
  return msg || 'Could not start the camera.';
}