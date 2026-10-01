function sameNullableNumber(left, right) {
  if (left === null || left === undefined) {
    return right === null || right === undefined;
  }
  if (right === null || right === undefined) {
    return false;
  }
  return Number(left) === Number(right);
}

export function projectSettingsAffectDerivedState(
  previous,
  next,
) {
  return (
    !sameNullableNumber(
      previous?.largeCityPopulationThreshold,
      next?.largeCityPopulationThreshold,
    ) ||
    !sameNullableNumber(
      previous?.largeCityAreaKm2Threshold,
      next?.largeCityAreaKm2Threshold,
    )
  );
}
