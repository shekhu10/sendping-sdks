<?php
declare(strict_types=1);

class RecoveryTransport extends \SendPing\Transport\CurlTransport
{
    public int $calls = 0;
    public array $requests = [];
    public function __construct(private array $case) { parent::__construct(30, 2); }
    protected function perform(string $method, string $url, array $headers, ?string $body): array
    {
        $this->requests[] = compact('method','url','headers','body');
        $this->calls++;
        return ['status'=>$this->calls===1 ? $this->case['status'] : 200,
            'body'=>json_encode($this->calls===1 ? $this->case['body'] : ['id'=>'em_retry']), 'retryAfter'=>'0'];
    }
    protected function sleepSeconds(float $seconds): void { }
}

$localCorpus = file_get_contents(__DIR__ . '/../fixtures/http-recovery-corpus.json');
$sharedCorpusPath = __DIR__ . '/../../../scripts/http-recovery-corpus.json';
if (is_file($sharedCorpusPath)) {
    check_same('recovery: package corpus matches source', file_get_contents($sharedCorpusPath), $localCorpus);
}
$cases = json_decode($localCorpus, true);
foreach ($cases as $case) {
    $transport = new RecoveryTransport($case);
    $headers = isset($case['key']) ? ['Idempotency-Key: '.$case['key']] : [];
    $result = $transport->request($case['method'], 'http://127.0.0.1'.$case['path'], $headers, '{}');
    check_same('recovery: '.$case['name'].' attempts', $case['attempts'], $transport->calls);
    check_same('recovery: '.$case['name'].' status', $case['attempts']===1 ? $case['status'] : 200, $result['status']);
    foreach ($transport->requests as $request) check_same('recovery: stable headers '.$case['name'], $headers, $request['headers']);
}

[$mb, $t] = make_client();
$t->queue(200, ['object'=>'email','id'=>'em_one']);
$mb->emails->receiving->reply('rcv_one', ['text'=>"a  b\n\n c"], ['idempotencyKey'=>'reply-1']);
check('recovery: reply key', in_array('Idempotency-Key: reply-1', $t->last()['headers'], true));
check_same('recovery: whitespace unchanged', "a  b\n\n c", $t->lastJson()['text']);
$t->queue(200, ['object'=>'email','id'=>'em_one']);
$mb->emails->receiving->forward('rcv_one', [], ['idempotencyKey'=>'forward-1']);
check('recovery: forward key', in_array('Idempotency-Key: forward-1', $t->last()['headers'], true));
$t->queue(200, ['custom_host'=>null,'status'=>'shared','checked_at'=>'2026-09-10T00:00:00Z']);
check_same('recovery: tracking status', 'shared', $mb->domains->trackingHealth('domain one')['status']);
check_same('recovery: tracking path', '/domains/domain%20one/tracking-health', $t->lastPath());
$error = \SendPing\Exceptions\SendPingException::fromResponse(422, ['statusCode'=>503,'id'=>'em_one','reserved'=>[['id'=>'em_one']],'unsent_count'=>0]);
check_same('recovery: HTTP status wins', 422, $error->getStatusCode());
check_same('recovery: original ID', 'em_one', $error->getId());
check_same('recovery: reserved prefix', [['id'=>'em_one']], $error->getReserved());
check_same('recovery: zero unattempted preserved', 0, $error->getUnsentCount());
