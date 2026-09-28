-- Відкат міграції 28: прибрати входи і функції дослідження. Кандидати,
-- джерела і опубліковані клейми, створені через них, лишаються: відкат
-- не переписує даних, а знання пройшло той самий gate, що і ручні картки.

drop function if exists public.mi_research_persist(text, jsonb);
drop function if exists public.mi_research_context(text);
drop function if exists mi.research_persist(text, jsonb);
drop function if exists mi.research_context(text);
