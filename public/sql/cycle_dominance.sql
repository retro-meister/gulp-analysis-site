WITH sweeps AS (
    SELECT
        *,
        CASE
            WHEN cycle <= 2 THEN drop_target_dist_0_1
            ELSE greatest(
                drop_target_dist_0_1,
                drop_target_dist_0_2,
                drop_target_dist_1_2
            )
        END AS spread,
        (
            (cycle = 1 AND bird0_drop = 7  AND bird1_drop = 5)
            OR (cycle = 2 AND bird0_drop = 1  AND bird1_drop = 14)
            OR (cycle = 3 AND bird0_drop = 15 AND bird1_drop = 6  AND bird2_drop = 16)
            OR (cycle = 4 AND bird0_drop = 25 AND bird1_drop = 10 AND bird2_drop = 11)
        ) AS is_wr
    FROM gulp_sweep
),
wr AS (
    SELECT
        cycle,
        spread AS wr_spread,
        cycle_complete_frame AS wr_frame
    FROM sweeps
    WHERE is_wr
),
classified AS (
    SELECT
        s.sim_index,
        s.cycle,
        s.spread,
        s.cycle_complete_frame AS frame,
        s.bird0_drop,
        s.bird1_drop,
        s.bird2_drop,
        s.bird0_egg_spawn_frame,
        s.bird1_egg_spawn_frame,
        s.bird2_egg_spawn_frame,
        s.is_wr,
        CASE
            WHEN s.is_wr THEN 'wr'
            WHEN s.cycle_complete_frame <= w.wr_frame AND s.spread <= w.wr_spread THEN 'dominator'
            WHEN s.cycle_complete_frame > w.wr_frame AND s.spread > w.wr_spread THEN 'dominated'
            ELSE 'tradeoff'
        END AS zone
    FROM sweeps s
    JOIN wr w USING (cycle)
)
SELECT
    sim_index,
    cycle,
    spread,
    frame,
    bird0_drop,
    bird1_drop,
    bird2_drop,
    bird0_egg_spawn_frame,
    bird1_egg_spawn_frame,
    bird2_egg_spawn_frame,
    is_wr,
    zone
FROM classified
ORDER BY cycle, spread, frame;
