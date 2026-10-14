import { readFileSync } from 'node:fs';
import babel from '@babel/core';
import React from 'react';

// Let's test renderInterests, renderAvailability, renderBio
import {
  ACTIVITY_CATEGORIES,
  RUNNING_PACE_OPTIONS,
  SELECTABLE_ACTIVITY_CATEGORIES,
  getRunningPace,
  sanitizeActivityDetails,
} from '../src/data/activityCategories.js';
import { formatAvailabilitySlots } from '../src/utils/formatters.js';

console.log('--- Testing Step 2 (Interests) Logic ---');
let interests = [];
console.log('Initial interests:', interests);

function toggleInterest(id) {
  interests = interests.includes(id) ? interests.filter((item) => item !== id) : [...interests, id];
}

// Test toggling every single category
SELECTABLE_ACTIVITY_CATEGORIES.forEach((cat) => {
  toggleInterest(cat.id);
  console.log('Toggled', cat.id, '-> interests:', interests);
  toggleInterest(cat.id);
});

// Test running with pace
toggleInterest('running');
let pace = '';
RUNNING_PACE_OPTIONS.forEach((opt) => {
  pace = opt;
  console.log('Selected pace:', pace);
});

console.log('\n--- Testing Step 3 (Availability) Logic ---');
let availabilitySlots = [];
console.log('Empty availabilitySlots summary:', formatAvailabilitySlots(availabilitySlots));

availabilitySlots = [
  { date: '2026-10-15', start: '18:00', end: '20:00' },
  { date: '2026-10-16', start: '19:00', end: '21:00' },
];
console.log('Filled availabilitySlots summary:', formatAvailabilitySlots(availabilitySlots));

console.log('\n--- Testing Step 4 (Bio) Logic ---');
let faculty = 'วิศวกรรมศาสตร์';
let year = 'ปี 2';
let name = 'สมชาย';
let age = '20';
let avatarUri = 'https://example.com/avatar.jpg';
let bio = 'สวัสดีครับ';

const facultyLine = [faculty, year].filter(Boolean).join(' · ');
const interestLabels = interests
  .map((id) => ACTIVITY_CATEGORIES.find((item) => item.id === id)?.shortLabel)
  .filter(Boolean);

console.log('facultyLine:', facultyLine);
console.log('interestLabels:', interestLabels);

console.log('\nAll step calculations succeeded without throwing!');
