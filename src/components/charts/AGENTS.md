# Chart rules

- Section lead trend charts combine Analytics blocks only through `alignTrends` (`src/components/charts/d3/trendAlign.ts`): one period kind per chart (others named, not drawn), unfinished periods left out, periods before a block's last counting-change marker left out. Why: a rebased comparison never mixes calendar and fiscal years or reads a coverage change as growth.
- Dot plots of units against a baseline use the median of the compared units (with a stated minimum size) and show any national aggregate beside it, not as the line. Why: a few mass-tort dockets can pull a national figure past most units.
- Sunbursts and remainder slices come only from exact partitions (children sum to the parent, checked against the corpus); a shortfall becomes "Not broken down", an excess drops the child ring. Why: a ring never claims more than its parent.
- The chart explorer (`explore/`) only regroups and sums rows the chart already loaded; its AI box returns field keys only, never figures. Why: the explorer must never become a source of numbers.
