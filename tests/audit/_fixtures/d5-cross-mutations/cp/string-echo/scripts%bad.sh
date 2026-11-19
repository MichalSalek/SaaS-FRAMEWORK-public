#!/bin/sh
printf '%s\n' 'cp -r dir dst'
echo 'cp-nest-allow: nope'
cp -r dir dst
