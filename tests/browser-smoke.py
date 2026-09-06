"""Optional Playwright integration test; no browser dependency is required by the app.
Run: pip install playwright; playwright install chromium; python tests/browser-smoke.py
Uses page.set_content so the test needs neither network access nor an HTTP server.
"""
from pathlib import Path
import json, os, shutil
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
    browser = p.chromium.launch(**({'executable_path': executable} if executable else {}), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1600, 'height':1000}, device_scale_factor=1)
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content((ROOT/'Vapora-Process-Studio.html').read_text(), wait_until='load')
    page.wait_for_function('window.vapora?.getResults()?.converged === true')
    checks=[]
    def checked(name, condition):
        assert condition, name
        checks.append(name)
    def action(name): page.locator('[data-action="'+name+'"]').first.click()
    def results(): return page.evaluate('vapora.getResults()')
    base=results()
    checked('Default recycle converges in a real Worker', base['iterations']==4)
    checked('Global material balance', abs(base['diagnostics']['globalMassResidual'])<1e-10)
    page.locator('#inspector-form [name=T]').fill('96')
    action('apply')
    checked('Specification edits invalidate numerical results', results() is None)
    action('run')
    page.wait_for_function('vapora.getResults()?.converged === true')
    checked('Changing drum temperature changes computed vapor flow', abs(results()['streams']['VAPOR']['F']-base['streams']['VAPOR']['F'])>1)
    action('undo')
    checked('Undo restores temperature specification', page.evaluate("vapora.getProject().nodes.find(n=>n.id==='flash').cfg.T")==368.15)
    action('redo')
    checked('Redo restores changed specification', page.evaluate("vapora.getProject().nodes.find(n=>n.id==='flash').cfg.T")==369.15)
    action('undo')
    action('run')
    page.wait_for_function('vapora.getResults()?.converged === true')
    page.locator('[data-node="flash"]').first.click()
    page.locator('[data-inspector="results"]').click()
    checked('Flash phase result inspector displays calculated flow', 'phase separation' in page.locator('#inspector').inner_text().lower())
    action('components')
    checked('Component selection dialog opens', 'Benzene' in page.locator('#modal').inner_text())
    action('close-modal')
    action('settings')
    page.locator('#modal [name="unit-set"]').select_option('US')
    action('apply-settings')
    page.locator('[data-node="flash"]').first.click()
    checked('Fahrenheit input conversion', abs(float(page.locator('#inspector-form [name=T]').input_value())-203)<1e-8)
    action('settings')
    page.locator('#modal [name="unit-set"]').select_option('Engineering')
    action('apply-settings')
    action('run')
    page.wait_for_function('vapora.getResults()?.converged === true')
    action('sensitivity')
    action('run-sensitivity')
    page.wait_for_function("document.querySelector('#page-content').innerText.includes('Calculated points')")
    rows=page.locator('#page-content .data-table tbody tr')
    checked('Sensitivity returns 13 independently calculated points', rows.count()==13)
    checked('Sensitivity contains converged results', 'converged' in rows.first.inner_text())
    page.wait_for_timeout(4600)
    page.screenshot(path=str(ROOT/'docs'/'sensitivity-preview.png'),full_page=True)
    # Restore a solved demo and capture a clean desktop preview.
    action('new'); action('new-demo'); action('run')
    page.wait_for_function('vapora.getResults()?.converged === true')
    page.screenshot(path=str(ROOT/'docs'/'desktop-preview.png'),full_page=True)
    # End-to-end model creation, using palette placement and real port picking.
    action('new'); action('new-blank')
    view=page.locator('#viewport').bounding_box()
    def canvas_click(x,y): page.mouse.click(view['x']+x,view['y']+y)
    for kind,x in [('feed',160),('heater',430),('product',700)]:
        page.locator('[data-add="'+kind+'"]').click();canvas_click(x,150)
    checked('Palette creates semantic model blocks', len(page.evaluate('vapora.getProject().nodes'))==3)
    model=page.evaluate('vapora.getProject()')
    camera=page.evaluate('vapora.getRenderer().camera')
    nodes={n['type']:n for n in model['nodes']}
    def port(kind,side):
        n=nodes[kind];x=n['x']+(116 if side=='out' else 0);y=n['y']+45
        canvas_click(x*camera['zoom']+camera['x'],y*camera['zoom']+camera['y'])
    action('tool-connect');port('feed','out');port('heater','in');port('heater','out');port('product','in')
    checked('Port picking connects material topology',len(page.evaluate('vapora.getProject().streams'))==2)
    action('run');page.wait_for_function('vapora.getResults()?.converged === true')
    checked('Newly built feed/heater/product process solves',len(results()['blocks'])==3)
    # Drag is a real geometry edit, not a new thermodynamic state.
    action('tool-select')
    n=nodes['heater'];x=(n['x']+58)*camera['zoom']+camera['x'];y=(n['y']+45)*camera['zoom']+camera['y']
    page.mouse.move(view['x']+x,view['y']+y);page.mouse.down();page.mouse.move(view['x']+x+30,view['y']+y+50,steps=5);page.mouse.up()
    moved=page.evaluate("vapora.getProject().nodes.find(n=>n.type==='heater')")
    checked('Canvas drag updates snapped model position',moved['y']!=n['y'] and moved['y']%10==0)
    checked('Geometry-only drag preserves computed results',results()['converged'])
    page.keyboard.press('Delete')
    checked('Delete removes node and attached streams',len(page.evaluate('vapora.getProject().nodes'))==2 and len(page.evaluate('vapora.getProject().streams'))==0)
    action('undo')
    checked('Undo restores deleted topology',len(page.evaluate('vapora.getProject().nodes'))==3 and len(page.evaluate('vapora.getProject().streams'))==2)
    # Portable project import uses the same parsing and validation path as file input.
    project_data=json.dumps(model)
    page.locator('#open-file').set_input_files({'name':'roundtrip.vapora.json','mimeType':'application/json','buffer':project_data.encode()})
    page.wait_for_function('vapora.getProject().nodes.length===3')
    checked('File input imports a saved project',page.evaluate('vapora.getProject().nodes[0].id')==model['nodes'][0]['id'])
    # Narrow viewport must remain usable without horizontal page overflow.
    mobile=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
    mobile.on('pageerror', lambda e: errors.append(str(e)))
    mobile.set_content((ROOT/'Vapora-Process-Studio.html').read_text(),wait_until='load')
    mobile.wait_for_function('vapora.getResults()?.converged === true')
    mobile.screenshot(path=str(ROOT/'docs'/'mobile-preview.png'),full_page=True)
    checked('Mobile viewport contains the application width',mobile.evaluate('document.documentElement.scrollWidth <= innerWidth && document.querySelector("#viewport").getBoundingClientRect().width <= innerWidth'))
    checked('Mobile initialization computes the same process',abs(mobile.evaluate('vapora.getResults().streams.VAPOR.F')-base['streams']['VAPOR']['F'])<1e-10)
    checked('No uncaught browser errors',not errors)
    result={'checks':checks,'passed':len(checks),'uncaughtErrors':errors,'backend':page.evaluate('vapora.getRenderer().mode'),'gpuTested':False,'context':'Opaque about:blank, standalone classic Worker; Canvas 2D fallback'}
    (ROOT/'docs'/'browser-validation.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
    browser.close()
