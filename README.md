# gtao-kch-loot-optimizer-tool

# Kortz Center Heist Loot Optimizer

Developed by dejarjar013, Mazemel, EtcherTM, and CMajor with help from Claude Code and Gemini

## Helps players determine what loot to grab during the Kortz Center Heist

### Instructions

### Model Details

* Normal  
  *   
* EMP  
  *   
* Greedy  
  * 

### Roadmap

* Moving to an “enter data” then “calculate” UI *(in progress)*  
  * Include player name  
  * Caching your inputs so they persist after navigating away, refreshing, or closing the browser mid-scope  
  * Can we collect input data to create average values to speed up filling things out? *(depends on caching above)*  
* Heist Guide — the results page you submit to, meant to be screenshotted/printed and used live during the heist *(in progress)*  
  * Per-player item assignments and floor locations  
  * Total combined secondary value  
  * Capacity utilized (could be less than 100\)  
  * Print/Save as image  
  * Allows you to save your security room code so it’s quickly available  
  * Color coded players for ease of legibility  
  * When to pop your EMP if you have it as part of your heist  
  * **Final form**: a floor-by-floor map of the Kortz Center with item locations pinned and color-coded by which player should grab them — everything above is the v1 this is headed toward  
* Different models for loot takes  
  * Normal — ships first  
  * EMP — partial now (EMP-on ships alongside Normal; EMP-off pending real floor travel-time data)  
  * Greedy — tabled until after Normal ships  
  * “Speedy” — a distinct model, not yet defined  
* Spreadsheet input?