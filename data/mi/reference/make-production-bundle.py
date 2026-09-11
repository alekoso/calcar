#!/usr/bin/env python3
"""Генератор production-бандла еталонної заливки.

Оригінальні файли заливки тримають помічників у pg_temp і тому вимагають
ОДНОГО psql-сеансу. Продакшн заливається окремими викликами, між якими
pg_temp не виживає.

Бандл відрізняється від оригіналу рівно одним: помічники живуть у
звичайній схемі mi_load, яку останній файл прибирає. Жодне твердження,
жоден кандидат і жодне джерело не змінюються.

Еквівалентність доводиться порівнянням двох свіжих баз:
canonical (один сеанс, оригінальні файли) проти bundle (окремі виклики).
"""

import glob
import os
import re

SRC = os.path.dirname(os.path.abspath(__file__))
DST = os.path.join(SRC, 'production')
TABLES = ['key_map', 'source_map', 'atom_map', 'atom_note']

HEADER = """-- СГЕНЕРОВАНО: data/mi/reference/make-production-bundle.py. Руками не правити.
-- Джерело: {name}
--
-- Відмінність від оригіналу рівно одна: помічники завантаження живуть не
-- у pg_temp, а у звичайній схемі mi_load. Це потрібно тому, що продакшн
-- заливається не одним psql-сеансом, а окремими викликами, між якими
-- pg_temp не виживає. Схема mi_load прибирається файлом 999.

"""


def convert(name, s):
    if name == '000_loader.sql':
        for t in TABLES:
            s = re.sub(r'create temporary table if not exists %s\b' % t,
                       'create table if not exists mi_load.%s' % t, s)
            # Решта згадок цих таблиць живе лише у тілах функцій, без схеми.
            # Лапка після імені тут НЕ означає виклик функції: це список
            # колонок у INSERT, і його теж треба кваліфікувати.
            s = re.sub(r'(?<![.\w])%s\b' % t, 'mi_load.%s' % t, s)
        s = s.replace('mi_load.mi_load.', 'mi_load.')
        s = s.replace('pg_temp.', 'mi_load.')
        s = 'create schema if not exists mi_load;\n\n' + s
    else:
        s = s.replace('pg_temp.', 'mi_load.')
    return s


def main():
    os.makedirs(DST, exist_ok=True)
    for path in sorted(glob.glob(os.path.join(SRC, '*.sql'))):
        name = os.path.basename(path)
        with open(path, encoding='utf-8') as fh:
            body = convert(name, fh.read())
        with open(os.path.join(DST, name), 'w', encoding='utf-8') as fh:
            fh.write(HEADER.format(name=name) + body)
        print(name, len(body))

    drop = os.path.join(DST, '999_drop_loader.sql')
    with open(drop, 'w', encoding='utf-8') as fh:
        fh.write('-- Помічники завантаження не є частиною Model Intelligence\n'
                 '-- і не повинні лишатись у продакшні.\n'
                 'drop schema if exists mi_load cascade;\n')
    print('999_drop_loader.sql')


if __name__ == '__main__':
    main()
