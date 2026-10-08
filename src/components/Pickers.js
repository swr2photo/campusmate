import React from 'react';

// Fallback for non-Android platforms (Web, iOS) where Jetpack Compose is not supported.
export const DatePickerDialog = () => null;
export const Host = ({ children }) => <>{children}</>;
export const TimePickerDialog = () => null;
