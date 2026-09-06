const form = document.querySelector('#report-config-form');

function updateRangeUi() {
  if (!form) return;

  for (const help of form.querySelectorAll('.report-format-help')) {
    const text = 'Диапазон задаётся как ≥ нижней границы и < верхней. Пустая нижняя/верхняя граница означает −∞/+∞. Для метрик используются отображаемые значения после масштаба. Смежные диапазоны должны использовать одну и ту же границу, например: < 91; ≥ 91 и < 201; ≥ 201. При пересечении применяется первое правило сверху.';
    if (help.textContent !== text) help.textContent = text;
  }

  for (const row of form.querySelectorAll('.report-format-rule-row')) {
    const numberLabels = [...row.children].filter((element) =>
      element.matches?.('label') && element.querySelector('input[type="number"]'));
    const [minLabel, maxLabel] = numberLabels;
    if (minLabel?.firstChild?.nodeType === Node.TEXT_NODE && minLabel.firstChild.textContent !== 'От (≥)') {
      minLabel.firstChild.textContent = 'От (≥)';
    }
    if (maxLabel?.firstChild?.nodeType === Node.TEXT_NODE && maxLabel.firstChild.textContent !== 'До (<)') {
      maxLabel.firstChild.textContent = 'До (<)';
    }
  }
}

if (form) {
  updateRangeUi();
  const observer = new MutationObserver(updateRangeUi);
  observer.observe(form, { childList: true, subtree: true });
}
