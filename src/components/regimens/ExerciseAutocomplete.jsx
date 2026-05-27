import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/LanguageContext';
import { muscleKey, translateExerciseName } from '@/lib/exerciseTranslations';
import { titleCase } from '@/lib/textCase';
import { getUsageScores } from '@/lib/recentExerciseUsage';
import { EQUIPMENT_FILTERS, matchesEquipment } from '@/lib/exerciseEquipment';

const EXERCISE_LIBRARY = [
  // Chest
  { name: 'Assisted Dip', muscles: ['Chest', 'Triceps'] },
  { name: 'Band-Assisted Bench Press', muscles: ['Chest', 'Triceps', 'Shoulders'] },
  { name: 'Bar Dip', muscles: ['Chest', 'Triceps'] },
  { name: 'Bench Press', muscles: ['Chest', 'Triceps', 'Shoulders'] },
  { name: 'Bench Press Against Band', muscles: ['Chest', 'Triceps'] },
  { name: 'Board Press', muscles: ['Chest', 'Triceps'] },
  { name: 'Cable Chest Press', muscles: ['Chest', 'Triceps'] },
  { name: 'Clap Push-Up', muscles: ['Chest', 'Triceps', 'Shoulders'] },
  { name: 'Close-Grip Bench Press', muscles: ['Triceps', 'Chest'] },
  { name: 'Close-Grip Feet-Up Bench Press', muscles: ['Triceps', 'Chest'] },
  { name: 'Cobra Push-Up', muscles: ['Chest', 'Shoulders'] },
  { name: 'Decline Bench Press', muscles: ['Chest', 'Triceps'] },
  { name: 'Decline Push-Up', muscles: ['Chest', 'Triceps'] },
  { name: 'Dumbbell Chest Fly', muscles: ['Chest'] },
  { name: 'Dumbbell Chest Press', muscles: ['Chest', 'Triceps', 'Shoulders'] },
  { name: 'Dumbbell Decline Chest Press', muscles: ['Chest', 'Triceps'] },
  { name: 'Dumbbell Floor Press', muscles: ['Chest', 'Triceps'] },
  { name: 'Dumbbell Pullover', muscles: ['Chest', 'Back'] },
  { name: 'Feet-Up Bench Press', muscles: ['Chest', 'Triceps'] },
  { name: 'Floor Press', muscles: ['Chest', 'Triceps'] },
  { name: 'Incline Bench Press', muscles: ['Chest', 'Shoulders', 'Triceps'] },
  { name: 'Incline Dumbbell Press', muscles: ['Chest', 'Shoulders', 'Triceps'] },
  { name: 'Incline Push-Up', muscles: ['Chest', 'Triceps'] },
  { name: 'Kettlebell Floor Press', muscles: ['Chest', 'Triceps'] },
  { name: 'Kneeling Incline Push-Up', muscles: ['Chest', 'Triceps'] },
  { name: 'Kneeling Push-Up', muscles: ['Chest', 'Triceps'] },
  { name: 'Machine Chest Fly', muscles: ['Chest'] },
  { name: 'Machine Chest Press', muscles: ['Chest', 'Triceps'] },
  { name: 'Medicine Ball Chest Pass', muscles: ['Chest', 'Triceps'] },
  { name: 'Pec Deck', muscles: ['Chest'] },
  { name: 'Pin Bench Press', muscles: ['Chest', 'Triceps'] },
  { name: 'Plank to Push-Up', muscles: ['Chest', 'Triceps', 'Core'] },
  { name: 'Push-Up', muscles: ['Chest', 'Triceps', 'Shoulders'] },
  { name: 'Push-Up Against Wall', muscles: ['Chest', 'Triceps'] },
  { name: 'Push-Ups With Feet in Rings', muscles: ['Chest', 'Triceps', 'Core'] },
  { name: 'Resistance Band Chest Fly', muscles: ['Chest'] },
  { name: 'Ring Dip', muscles: ['Chest', 'Triceps'] },
  { name: 'Seated Cable Chest Fly', muscles: ['Chest'] },
  { name: 'Smith Machine Bench Press', muscles: ['Chest', 'Triceps'] },
  { name: 'Smith Machine Incline Bench Press', muscles: ['Chest', 'Shoulders'] },
  { name: 'Smith Machine Reverse Grip Bench Press', muscles: ['Chest', 'Triceps'] },
  { name: 'Standing Cable Chest Fly', muscles: ['Chest'] },
  { name: 'Standing Resistance Band Chest Fly', muscles: ['Chest'] },

  // Shoulders
  { name: 'Arnold Press', muscles: ['Shoulders'] },
  { name: 'Band External Shoulder Rotation', muscles: ['Shoulders'] },
  { name: 'Band Internal Shoulder Rotation', muscles: ['Shoulders'] },
  { name: 'Band Pull-Apart', muscles: ['Shoulders', 'Back'] },
  { name: 'Banded Face Pull', muscles: ['Shoulders', 'Back'] },
  { name: 'Barbell Front Raise', muscles: ['Shoulders'] },
  { name: 'Barbell Rear Delt Row', muscles: ['Shoulders', 'Back'] },
  { name: 'Barbell Upright Row', muscles: ['Shoulders', 'Triceps'] },
  { name: 'Behind the Neck Press', muscles: ['Shoulders', 'Triceps'] },
  { name: 'Cable External Shoulder Rotation', muscles: ['Shoulders'] },
  { name: 'Cable Internal Shoulder Rotation', muscles: ['Shoulders'] },
  { name: 'Cable Front Raise', muscles: ['Shoulders'] },
  { name: 'Cable Lateral Raise', muscles: ['Shoulders'] },
  { name: 'Cable Rear Delt Row', muscles: ['Shoulders', 'Back'] },
  { name: 'Cuban Press', muscles: ['Shoulders'] },
  { name: 'Devils Press', muscles: ['Shoulders', 'Full Body'] },
  { name: 'Dumbbell Front Raise', muscles: ['Shoulders'] },
  { name: 'Dumbbell Lateral Raise', muscles: ['Shoulders'] },
  { name: 'Dumbbell Rear Delt Row', muscles: ['Shoulders', 'Back'] },
  { name: 'Dumbbell Shoulder Press', muscles: ['Shoulders', 'Triceps'] },
  { name: 'Face Pull', muscles: ['Shoulders', 'Back'] },
  { name: 'Front Hold', muscles: ['Shoulders'] },
  { name: 'Handstand Push-Up', muscles: ['Shoulders', 'Triceps'] },
  { name: 'Jerk', muscles: ['Shoulders', 'Legs', 'Full Body'] },
  { name: 'Kettlebell Halo', muscles: ['Shoulders', 'Core'] },
  { name: 'Kettlebell Press', muscles: ['Shoulders', 'Triceps'] },
  { name: 'Kettlebell Push Press', muscles: ['Shoulders', 'Legs'] },
  { name: 'Landmine Press', muscles: ['Shoulders', 'Chest'] },
  { name: 'Lying Dumbbell External Shoulder Rotation', muscles: ['Shoulders'] },
  { name: 'Lying Dumbbell Internal Shoulder Rotation', muscles: ['Shoulders'] },
  { name: 'Machine Lateral Raise', muscles: ['Shoulders'] },
  { name: 'Machine Shoulder Press', muscles: ['Shoulders', 'Triceps'] },
  { name: 'Monkey Row', muscles: ['Shoulders', 'Back'] },
  { name: 'One-Arm Landmine Press', muscles: ['Shoulders', 'Chest'] },
  { name: 'Overhead Press', muscles: ['Shoulders', 'Triceps'] },
  { name: 'Plate Front Raise', muscles: ['Shoulders'] },
  { name: 'Poliquin Raise', muscles: ['Shoulders'] },
  { name: 'Power Jerk', muscles: ['Shoulders', 'Legs', 'Full Body'] },
  { name: 'Push Press', muscles: ['Shoulders', 'Legs'] },
  { name: 'Resistance Band Lateral Raise', muscles: ['Shoulders'] },
  { name: 'Reverse Cable Flyes', muscles: ['Shoulders', 'Back'] },
  { name: 'Reverse Dumbbell Flyes', muscles: ['Shoulders', 'Back'] },
  { name: 'Reverse Dumbbell Flyes on Incline Bench', muscles: ['Shoulders', 'Back'] },
  { name: 'Reverse Machine Fly', muscles: ['Shoulders', 'Back'] },
  { name: 'Seated Barbell Overhead Press', muscles: ['Shoulders', 'Triceps'] },
  { name: 'Seated Dumbbell Shoulder Press', muscles: ['Shoulders', 'Triceps'] },
  { name: 'Seated Kettlebell Press', muscles: ['Shoulders', 'Triceps'] },
  { name: 'Seated Smith Machine Shoulder Press', muscles: ['Shoulders', 'Triceps'] },
  { name: 'Smith Machine Landmine Press', muscles: ['Shoulders', 'Chest'] },
  { name: 'Snatch Grip Behind the Neck Press', muscles: ['Shoulders', 'Back'] },
  { name: 'Squat Jerk', muscles: ['Shoulders', 'Legs', 'Full Body'] },
  { name: 'Split Jerk', muscles: ['Shoulders', 'Legs', 'Full Body'] },
  { name: 'Turkish Get-Up', muscles: ['Shoulders', 'Core', 'Full Body'] },
  { name: 'Wall Walk', muscles: ['Shoulders', 'Core'] },
  { name: 'Z Press', muscles: ['Shoulders', 'Triceps', 'Core'] },

  // Biceps
  { name: 'Barbell Curl', muscles: ['Biceps'] },
  { name: 'Barbell Preacher Curl', muscles: ['Biceps'] },
  { name: 'Bayesian Curl', muscles: ['Biceps'] },
  { name: 'Bodyweight Curl', muscles: ['Biceps'] },
  { name: 'Cable Crossover Bicep Curl', muscles: ['Biceps'] },
  { name: 'Cable Curl With Bar', muscles: ['Biceps'] },
  { name: 'Cable Curl With Rope', muscles: ['Biceps'] },
  { name: 'Concentration Curl', muscles: ['Biceps'] },
  { name: 'Drag Curl', muscles: ['Biceps'] },
  { name: 'Dumbbell Curl', muscles: ['Biceps'] },
  { name: 'Dumbbell Preacher Curl', muscles: ['Biceps'] },
  { name: 'EZ Curl', muscles: ['Biceps'] },
  { name: 'Hammer Curl', muscles: ['Biceps'] },
  { name: 'Incline Dumbbell Curl', muscles: ['Biceps'] },
  { name: 'Kettlebell Curl', muscles: ['Biceps'] },
  { name: 'Lying Bicep Cable Curl on Bench', muscles: ['Biceps'] },
  { name: 'Lying Bicep Cable Curl on Floor', muscles: ['Biceps'] },
  { name: 'Machine Bicep Curl', muscles: ['Biceps'] },
  { name: 'Overhead Cable Curl', muscles: ['Biceps'] },
  { name: 'Resistance Band Curl', muscles: ['Biceps'] },
  { name: 'Reverse Barbell Curl', muscles: ['Biceps'] },
  { name: 'Reverse Dumbbell Curl', muscles: ['Biceps'] },
  { name: 'Spider Curl', muscles: ['Biceps'] },
  { name: 'Zottman Curl', muscles: ['Biceps'] },

  // Triceps
  { name: 'Barbell Standing Triceps Extension', muscles: ['Triceps'] },
  { name: 'Barbell Incline Triceps Extension', muscles: ['Triceps'] },
  { name: 'Barbell Lying Triceps Extension', muscles: ['Triceps'] },
  { name: 'Bench Dip', muscles: ['Triceps', 'Chest'] },
  { name: 'Close-Grip Push-Up', muscles: ['Triceps', 'Chest'] },
  { name: 'Crossbody Cable Triceps Extension', muscles: ['Triceps'] },
  { name: 'Dumbbell Lying Triceps Extension', muscles: ['Triceps'] },
  { name: 'Dumbbell Standing Triceps Extension', muscles: ['Triceps'] },
  { name: 'EZ Bar Lying Triceps Extension', muscles: ['Triceps'] },
  { name: 'Machine Overhead Triceps Extension', muscles: ['Triceps'] },
  { name: 'Overhead Cable Triceps Extension (Lower Position)', muscles: ['Triceps'] },
  { name: 'Overhead Cable Triceps Extension (Upper Position)', muscles: ['Triceps'] },
  { name: 'Smith Machine Skull Crushers', muscles: ['Triceps'] },
  { name: 'Tate Press', muscles: ['Triceps'] },
  { name: 'Tricep Bodyweight Extension', muscles: ['Triceps'] },
  { name: 'Tricep Pushdown With Bar', muscles: ['Triceps'] },
  { name: 'Tricep Pushdown With Rope', muscles: ['Triceps'] },

  // Legs
  { name: 'Air Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Banded Hip March', muscles: ['Legs', 'Glutes'] },
  { name: 'Barbell Hack Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Barbell Lunge', muscles: ['Legs', 'Glutes'] },
  { name: 'Barbell Walking Lunge', muscles: ['Legs', 'Glutes'] },
  { name: 'Belt Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Body Weight Lunge', muscles: ['Legs', 'Glutes'] },
  { name: 'Bodyweight Leg Curl', muscles: ['Legs'] },
  { name: 'Box Jump', muscles: ['Legs', 'Glutes'] },
  { name: 'Box Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Bulgarian Split Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Cable Machine Hip Adduction', muscles: ['Legs'] },
  { name: 'Chair Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Curtsy Lunge', muscles: ['Legs', 'Glutes'] },
  { name: 'Depth Jump', muscles: ['Legs', 'Glutes'] },
  { name: 'Dumbbell Lunge', muscles: ['Legs', 'Glutes'] },
  { name: 'Dumbbell Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Dumbbell Walking Lunge', muscles: ['Legs', 'Glutes'] },
  { name: 'Front Squat', muscles: ['Legs', 'Glutes', 'Core'] },
  { name: 'Glute Ham Raise', muscles: ['Legs', 'Glutes'] },
  { name: 'Goblet Squat', muscles: ['Legs', 'Glutes', 'Core'] },
  { name: 'Ground to Overhead', muscles: ['Full Body'] },
  { name: 'Hack Squat Machine', muscles: ['Legs', 'Glutes'] },
  { name: 'Half Air Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Heel Walk', muscles: ['Legs'] },
  { name: 'Hip Adduction Against Band', muscles: ['Legs'] },
  { name: 'Hip Adduction Machine', muscles: ['Legs'] },
  { name: 'Jump Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Jumping Lunge', muscles: ['Legs', 'Glutes'] },
  { name: 'Kettlebell Front Squat', muscles: ['Legs', 'Glutes', 'Core'] },
  { name: 'Kettlebell Thrusters', muscles: ['Legs', 'Glutes', 'Shoulders'] },
  { name: 'Kettlebell Tibialis Raise', muscles: ['Legs'] },
  { name: 'Landmine Hack Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Landmine Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Lateral Bound', muscles: ['Legs', 'Glutes'] },
  { name: 'Leg Curl On Ball', muscles: ['Legs'] },
  { name: 'Leg Extension', muscles: ['Legs'] },
  { name: 'Leg Press', muscles: ['Legs', 'Glutes'] },
  { name: 'Lying Leg Curl', muscles: ['Legs'] },
  { name: 'Nordic Hamstring Eccentric', muscles: ['Legs'] },
  { name: 'One-Legged Leg Extension', muscles: ['Legs'] },
  { name: 'One-Legged Lying Leg Curl', muscles: ['Legs'] },
  { name: 'One-Legged Seated Leg Curl', muscles: ['Legs'] },
  { name: 'Pause Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Pendulum Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Pin Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Pistol Squat', muscles: ['Legs', 'Glutes', 'Core'] },
  { name: 'Poliquin Step-Up', muscles: ['Legs', 'Glutes'] },
  { name: 'Prisoner Get Up', muscles: ['Legs', 'Core'] },
  { name: 'Reverse Barbell Lunge', muscles: ['Legs', 'Glutes'] },
  { name: 'Reverse Body Weight Lunge', muscles: ['Legs', 'Glutes'] },
  { name: 'Reverse Dumbbell Lunge', muscles: ['Legs', 'Glutes'] },
  { name: 'Reverse Nordic', muscles: ['Legs'] },
  { name: 'Romanian Deadlift', muscles: ['Glutes', 'Legs', 'Back'] },
  { name: 'Safety Bar Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Seated Leg Curl', muscles: ['Legs'] },
  { name: 'Shallow Body Weight Lunge', muscles: ['Legs', 'Glutes'] },
  { name: 'Side Lunges (Bodyweight)', muscles: ['Legs', 'Glutes'] },
  { name: 'Smith Machine Bulgarian Split Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Smith Machine Front Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Smith Machine Lunge', muscles: ['Legs', 'Glutes'] },
  { name: 'Smith Machine Romanian Deadlift', muscles: ['Glutes', 'Legs'] },
  { name: 'Smith Machine Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Squat', muscles: ['Legs', 'Glutes', 'Core'] },
  { name: 'Standing Cable Leg Extension', muscles: ['Legs'] },
  { name: 'Standing Hip Flexor Raise', muscles: ['Legs'] },
  { name: 'Standing Leg Curl', muscles: ['Legs'] },
  { name: 'Step Up', muscles: ['Legs', 'Glutes'] },
  { name: 'Sumo Squat', muscles: ['Legs', 'Glutes'] },
  { name: 'Tibialis Band Pull', muscles: ['Legs'] },
  { name: 'Tibialis Raise', muscles: ['Legs'] },
  { name: 'Vertical Leg Press', muscles: ['Legs', 'Glutes'] },
  { name: 'Zercher Squat', muscles: ['Legs', 'Glutes', 'Core'] },
  { name: 'Zombie Squat', muscles: ['Legs', 'Core'] },

  // Back
  { name: 'Assisted Chin-Up', muscles: ['Back', 'Biceps'] },
  { name: 'Assisted Pull-Up', muscles: ['Back', 'Biceps'] },
  { name: 'Back Extension', muscles: ['Back', 'Glutes'] },
  { name: 'Banded Muscle-Up', muscles: ['Back', 'Chest', 'Triceps'] },
  { name: 'Barbell Row', muscles: ['Back', 'Biceps'] },
  { name: 'Barbell Shrug', muscles: ['Back', 'Shoulders'] },
  { name: 'Block Clean', muscles: ['Back', 'Legs', 'Full Body'] },
  { name: 'Block Snatch', muscles: ['Back', 'Legs', 'Full Body'] },
  { name: 'Cable Close Grip Seated Row', muscles: ['Back', 'Biceps'] },
  { name: 'Cable Wide Grip Seated Row', muscles: ['Back', 'Biceps'] },
  { name: 'Chest-Supported Dumbbell Row', muscles: ['Back', 'Biceps'] },
  { name: 'Chest to Bar', muscles: ['Back', 'Biceps'] },
  { name: 'Chin-Up', muscles: ['Back', 'Biceps'] },
  { name: 'Clean', muscles: ['Back', 'Legs', 'Full Body'] },
  { name: 'Clean and Jerk', muscles: ['Full Body'] },
  { name: 'Close-Grip Chin-Up', muscles: ['Back', 'Biceps'] },
  { name: 'Close-Grip Lat Pulldown', muscles: ['Back', 'Biceps'] },
  { name: 'Deadlift', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Deficit Deadlift', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Dumbbell Deadlift', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Dumbbell Row', muscles: ['Back', 'Biceps'] },
  { name: 'Dumbbell Shrug', muscles: ['Back', 'Shoulders'] },
  { name: 'Floor Back Extension', muscles: ['Back', 'Glutes'] },
  { name: 'Good Morning', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Gorilla Row', muscles: ['Back', 'Biceps'] },
  { name: 'Hang Clean', muscles: ['Back', 'Legs', 'Full Body'] },
  { name: 'Hang Power Clean', muscles: ['Back', 'Legs', 'Full Body'] },
  { name: 'Hang Power Snatch', muscles: ['Back', 'Legs', 'Full Body'] },
  { name: 'Hang Snatch', muscles: ['Back', 'Legs', 'Full Body'] },
  { name: 'Inverted Row', muscles: ['Back', 'Biceps'] },
  { name: 'Inverted Row with Underhand Grip', muscles: ['Back', 'Biceps'] },
  { name: 'Jefferson Curl', muscles: ['Back'] },
  { name: 'Jumping Muscle-Up', muscles: ['Back', 'Chest', 'Triceps'] },
  { name: 'Kettlebell Clean', muscles: ['Back', 'Legs'] },
  { name: 'Kettlebell Clean & Jerk', muscles: ['Full Body'] },
  { name: 'Kettlebell Clean & Press', muscles: ['Full Body'] },
  { name: 'Kettlebell Row', muscles: ['Back', 'Biceps'] },
  { name: 'Kettlebell Snatch', muscles: ['Back', 'Shoulders', 'Legs'] },
  { name: 'Kettlebell Swing', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Kroc Row', muscles: ['Back', 'Biceps'] },
  { name: 'Lat Pulldown With Neutral Grip', muscles: ['Back', 'Biceps'] },
  { name: 'Lat Pulldown With Pronated Grip', muscles: ['Back', 'Biceps'] },
  { name: 'Lat Pulldown With Supinated Grip', muscles: ['Back', 'Biceps'] },
  { name: 'Machine Lat Pulldown', muscles: ['Back', 'Biceps'] },
  { name: 'Muscle-Up (Bar)', muscles: ['Back', 'Chest', 'Triceps'] },
  { name: 'Muscle-Up (Rings)', muscles: ['Back', 'Chest', 'Triceps'] },
  { name: 'Neutral Close-Grip Lat Pulldown', muscles: ['Back', 'Biceps'] },
  { name: 'One-Handed Cable Row', muscles: ['Back', 'Biceps'] },
  { name: 'One-Handed Kettlebell Swing', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'One-Handed Lat Pulldown', muscles: ['Back', 'Biceps'] },
  { name: 'Pause Deadlift', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Pendlay Row', muscles: ['Back', 'Biceps'] },
  { name: 'Power Clean', muscles: ['Back', 'Legs', 'Full Body'] },
  { name: 'Power Snatch', muscles: ['Back', 'Legs', 'Full Body'] },
  { name: 'Pull-Up', muscles: ['Back', 'Biceps'] },
  { name: 'Pull-Up With a Neutral Grip', muscles: ['Back', 'Biceps'] },
  { name: 'Rack Pull', muscles: ['Back', 'Glutes'] },
  { name: 'Renegade Row', muscles: ['Back', 'Core', 'Biceps'] },
  { name: 'Ring Pull-Up', muscles: ['Back', 'Biceps'] },
  { name: 'Ring Row', muscles: ['Back', 'Biceps'] },
  { name: 'Rope Pulldown', muscles: ['Back', 'Biceps'] },
  { name: 'Scap Pull-Up', muscles: ['Back'] },
  { name: 'Seal Row', muscles: ['Back', 'Biceps'] },
  { name: 'Seated Machine Row', muscles: ['Back', 'Biceps'] },
  { name: 'Single Leg Deadlift with Kettlebell', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Smith Machine Deadlift', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Smith Machine One-Handed Row', muscles: ['Back', 'Biceps'] },
  { name: 'Snatch', muscles: ['Full Body'] },
  { name: 'Snatch Grip Deadlift', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Stiff-Legged Deadlift', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Straight Arm Lat Pulldown', muscles: ['Back'] },
  { name: 'Sumo Deadlift', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Superman Raise', muscles: ['Back', 'Glutes'] },
  { name: 'T-Bar Row', muscles: ['Back', 'Biceps'] },
  { name: 'Towel Row', muscles: ['Back', 'Biceps'] },
  { name: 'Trap Bar Deadlift With High Handles', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Trap Bar Deadlift With Low Handles', muscles: ['Back', 'Glutes', 'Legs'] },

  // Glutes
  { name: 'Banded Side Kicks', muscles: ['Glutes'] },
  { name: 'Cable Glute Kickback', muscles: ['Glutes'] },
  { name: 'Cable Pull Through', muscles: ['Glutes', 'Back'] },
  { name: 'Cable Machine Hip Abduction', muscles: ['Glutes'] },
  { name: 'Clamshells', muscles: ['Glutes'] },
  { name: 'Cossack Squat', muscles: ['Glutes', 'Legs'] },
  { name: 'Death March with Dumbbells', muscles: ['Glutes', 'Legs'] },
  { name: 'Donkey Kicks', muscles: ['Glutes'] },
  { name: 'Dumbbell Romanian Deadlift', muscles: ['Glutes', 'Back', 'Legs'] },
  { name: 'Dumbbell Frog Pumps', muscles: ['Glutes'] },
  { name: 'Fire Hydrants', muscles: ['Glutes'] },
  { name: 'Frog Pumps', muscles: ['Glutes'] },
  { name: 'Glute Bridge', muscles: ['Glutes'] },
  { name: 'Hip Abduction Against Band', muscles: ['Glutes'] },
  { name: 'Hip Abduction Machine', muscles: ['Glutes'] },
  { name: 'Hip Thrust', muscles: ['Glutes'] },
  { name: 'Hip Thrust Machine', muscles: ['Glutes'] },
  { name: 'Hip Thrust With Band Around Knees', muscles: ['Glutes'] },
  { name: 'Kettlebell Windmill', muscles: ['Glutes', 'Core', 'Shoulders'] },
  { name: 'Lateral Walk With Band', muscles: ['Glutes'] },
  { name: 'Machine Glute Kickbacks', muscles: ['Glutes'] },
  { name: 'One-Legged Glute Bridge', muscles: ['Glutes'] },
  { name: 'One-Legged Hip Thrust', muscles: ['Glutes'] },
  { name: 'Reverse Hyperextension', muscles: ['Glutes', 'Back'] },
  { name: 'Single Leg Romanian Deadlift', muscles: ['Glutes', 'Back', 'Legs'] },
  { name: 'Smith Machine Hip Thrust', muscles: ['Glutes'] },
  { name: 'Standing Glute Kickback in Machine', muscles: ['Glutes'] },
  { name: 'Standing Glute Push Down', muscles: ['Glutes'] },
  { name: 'Standing Hip Abduction Against Band', muscles: ['Glutes'] },

  // Abs / Core
  { name: 'Ball Slams', muscles: ['Core', 'Full Body'] },
  { name: 'Bicycle Crunch', muscles: ['Core'] },
  { name: 'Cable Crunch', muscles: ['Core'] },
  { name: "Captain's Chair Knee Raise", muscles: ['Core'] },
  { name: "Captain's Chair Leg Raise", muscles: ['Core'] },
  { name: 'Copenhagen Plank', muscles: ['Core', 'Legs'] },
  { name: 'Core Twist', muscles: ['Core'] },
  { name: 'Crunch', muscles: ['Core'] },
  { name: 'Dead Bug', muscles: ['Core'] },
  { name: 'Dead Bug With Dumbbells', muscles: ['Core'] },
  { name: 'Dragon Flag', muscles: ['Core'] },
  { name: 'Dumbbell Side Bend', muscles: ['Core'] },
  { name: 'Dynamic Side Plank', muscles: ['Core'] },
  { name: 'Hanging Knee Raise', muscles: ['Core'] },
  { name: 'Hanging Leg Raise', muscles: ['Core'] },
  { name: 'Hanging Sit-Up', muscles: ['Core'] },
  { name: 'Hanging Windshield Wiper', muscles: ['Core'] },
  { name: 'High to Low Wood Chop with Band', muscles: ['Core'] },
  { name: 'High to Low Wood Chop with Cable', muscles: ['Core'] },
  { name: 'Hollow Body Crunch', muscles: ['Core'] },
  { name: 'Hollow Hold', muscles: ['Core'] },
  { name: 'Horizontal Wood Chop with Band', muscles: ['Core'] },
  { name: 'Horizontal Wood Chop with Cable', muscles: ['Core'] },
  { name: 'Jackknife Sit-Up', muscles: ['Core'] },
  { name: 'Kettlebell Plank Pull Through', muscles: ['Core'] },
  { name: 'Kneeling Ab Wheel Roll-Out', muscles: ['Core'] },
  { name: 'Kneeling Plank', muscles: ['Core'] },
  { name: 'Kneeling Side Plank', muscles: ['Core'] },
  { name: 'L-Sit', muscles: ['Core'] },
  { name: 'Landmine Rotation', muscles: ['Core', 'Shoulders'] },
  { name: 'Low to High Wood Chop with Band', muscles: ['Core'] },
  { name: 'Low to High Wood Chop with Cable', muscles: ['Core'] },
  { name: 'Lying Leg Raise', muscles: ['Core'] },
  { name: 'Lying Windshield Wiper', muscles: ['Core'] },
  { name: 'Lying Windshield Wiper with Bent Knees', muscles: ['Core'] },
  { name: 'Machine Crunch', muscles: ['Core'] },
  { name: 'Mountain Climbers', muscles: ['Core', 'Cardio'] },
  { name: 'Oblique Crunch', muscles: ['Core'] },
  { name: 'Oblique Sit-Up', muscles: ['Core'] },
  { name: 'Pallof Press', muscles: ['Core'] },
  { name: 'Plank', muscles: ['Core'] },
  { name: 'Plank with Leg Lifts', muscles: ['Core', 'Glutes'] },
  { name: 'Plank with Shoulder Taps', muscles: ['Core', 'Shoulders'] },
  { name: 'Side Plank', muscles: ['Core'] },
  { name: 'Sit-Up', muscles: ['Core'] },
  { name: 'Weighted Plank', muscles: ['Core'] },

  // Calves
  { name: 'Barbell Seated Calf Raise', muscles: ['Legs'] },
  { name: 'Barbell Standing Calf Raise', muscles: ['Legs'] },
  { name: 'Calf Raise in Leg Press', muscles: ['Legs'] },
  { name: 'Donkey Calf Raise', muscles: ['Legs'] },
  { name: 'Eccentric Heel Drop', muscles: ['Legs'] },
  { name: 'Heel Raise', muscles: ['Legs'] },
  { name: 'Seated Calf Raise', muscles: ['Legs'] },
  { name: 'Standing Calf Raise', muscles: ['Legs'] },

  // Forearms & Grip
  { name: 'Bar Hang', muscles: ['Back'] },
  { name: 'Barbell Wrist Curl', muscles: ['Back'] },
  { name: 'Barbell Wrist Curl Behind the Back', muscles: ['Back'] },
  { name: 'Barbell Wrist Extension', muscles: ['Back'] },
  { name: 'Dumbbell Wrist Curl', muscles: ['Back'] },
  { name: 'Dumbbell Wrist Extension', muscles: ['Back'] },
  { name: 'Farmers Walk', muscles: ['Back', 'Core', 'Legs'] },
  { name: 'Fat Bar Deadlift', muscles: ['Back', 'Glutes', 'Legs'] },
  { name: 'Gripper', muscles: ['Back'] },
  { name: 'One-Handed Bar Hang', muscles: ['Back'] },
  { name: 'Plate Pinch', muscles: ['Back'] },
  { name: 'Plate Wrist Curl', muscles: ['Back'] },
  { name: 'Towel Pull-Up', muscles: ['Back', 'Biceps'] },
  { name: 'Wrist Roller', muscles: ['Back'] },

  // Neck
  { name: 'Lying Neck Curl', muscles: ['Full Body'] },
  { name: 'Lying Neck Extension', muscles: ['Full Body'] },
  { name: 'Prone Neck Bridge', muscles: ['Full Body'] },
  { name: 'Supine Neck Bridge', muscles: ['Full Body'] },

  // Cardio
  { name: 'Rowing Machine', muscles: ['Cardio', 'Back', 'Legs'] },
  { name: 'Stationary Bike', muscles: ['Cardio', 'Legs'] },
  { name: 'Running', muscles: ['Cardio', 'Legs'] },
  { name: 'Cycling', muscles: ['Cardio', 'Legs'] },
  { name: 'Jump Rope', muscles: ['Cardio'] },
];

export { EXERCISE_LIBRARY };

export default function ExerciseAutocomplete({ value, onChange, onSelect, placeholder, userEmail }) {
  const { t, language } = useLanguage();
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [equipmentFilter, setEquipmentFilter] = useState('all');
  const ref = useRef(null);

  // Recently-used exercise ranking — boost exercises the user has
  // logged recently/frequently above alphabetical baseline. After a
  // week of training, typing "b" surfaces "Bench Press" first
  // because the user logs it 3× a week. Scores from localStorage
  // (no server round-trip).
  const usageScores = useMemo(() => getUsageScores(userEmail), [userEmail]);

  // Search the FULL EXERCISE_LIBRARY (~400 exercises), not just the ~60
  // that happen to have entries in EXERCISE_TRANSLATIONS. searchExercises()
  // only iterates the translation table, so hundreds of real library
  // exercises (RDL variants, hip abduction, back extensions, most machines)
  // were unreachable from the autocomplete — the user typed the name and got
  // nothing. We match the English name plus the user-language display name so
  // the translated subset still matches in-language; everything else matches
  // by its English name. (Beta feedback: "add all the exercises / machines.")
  const suggestions = query.length >= 1
    ? (() => {
        const q = query.trim().toLowerCase();
        return EXERCISE_LIBRARY
          .map(ex => {
            const displayName = translateExerciseName(ex.name, language);
            const matchesEn = ex.name.toLowerCase().includes(q);
            const matchesLocal = displayName.toLowerCase().includes(q);
            if (!matchesEn && !matchesLocal) return null;
            const usageScore = usageScores[ex.name.toLowerCase()] || 0;
            return {
              name: ex.name,
              displayName,
              muscles: ex.muscles || [],
              usageScore,
              isRecent: usageScore > 0.25, // mark visually for top recents
            };
          })
          .filter(Boolean)
          // Equipment filter — drop matches that don't fit the chosen
          // category. Inferred from the exercise name (no schema change).
          .filter(s => matchesEquipment(s.name, equipmentFilter))
          // Rank: recently-used first, then prefix matches ("ben" → "Bench
          // Press" before "Barbell Bench…"), then alphabetical.
          .sort((a, b) => {
            if ((b.usageScore || 0) !== (a.usageScore || 0)) return (b.usageScore || 0) - (a.usageScore || 0);
            const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
            const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
            if (ap !== bp) return ap - bp;
            return a.name.localeCompare(b.name);
          })
          .slice(0, 10);
      })()
    : [];

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  const handleChange = (e) => {
    setQuery(e.target.value);
    onChange(e.target.value);
    setOpen(true);
  };

  const handleSelect = (exercise) => {
    setQuery(exercise.displayName || exercise.name);
    onChange(exercise.displayName || exercise.name);
    onSelect(exercise);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <Input
        value={query}
        onChange={handleChange}
        onFocus={() => query.length >= 1 && setOpen(true)}
        // Smart title-case on blur — turns "bench press" into "Bench
        // Press" so a user's exercise library looks intentional
        // instead of scruffy. Preserves acronyms (RDL, OHP, BCAA,
        // etc.) and respects mostly-uppercase input.
        onBlur={() => {
          const cleaned = titleCase(query);
          if (cleaned !== query) {
            setQuery(cleaned);
            onChange(cleaned);
          }
        }}
        placeholder={placeholder || 'Search exercise...'}
        autoComplete="off"
      />
      {/* Equipment filter — visible whenever the dropdown is open OR a
          non-default filter is active. Lets the user say "I only have
          dumbbells today" without typing the equipment into the
          search box. */}
      {(open || equipmentFilter !== 'all') && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 flex gap-1 overflow-x-auto px-1 pb-2 no-scrollbar" style={{ scrollbarWidth: 'none' }}>
          {EQUIPMENT_FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setEquipmentFilter(f.id); }}
              className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border transition-colors ${
                equipmentFilter === f.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border/60 text-muted-foreground hover:border-primary/40 bg-card'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute z-40 left-0 right-0 bg-card border border-border rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto" style={{ top: 'calc(100% + 28px)' }}>
          {suggestions.map((ex) => (
            <button
              key={ex.name}
              type="button"
              onMouseDown={() => handleSelect(ex)}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-secondary transition-colors flex items-center justify-between gap-3"
            >
              <span className="font-medium">{ex.displayName}</span>
              <span className="text-xs text-muted-foreground truncate">{ex.muscles.map(m => t(`muscleGroups.${muscleKey(m)}`)).join(', ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}