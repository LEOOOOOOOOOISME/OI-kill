#pragma once
#include <string>
#include <vector>
#include <deque>
#include <map>
#include <set>
#include <memory>
#include <chrono>
#include <random>
#include <mutex>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

// 卡牌类型
enum CardType { BASIC_ATTACK, BASIC_DODGE, BASIC_HEAL, WEAPON, ARMOR,
                MOUNT_OFF, MOUNT_DEF, FUNC, SPECIAL_EASTER };

struct Card {
    int id;
    std::string name;
    std::string suit;   // spade club heart diamond
    int number;
    CardType type;
    bool evolved;
    int targetId;
    Card() : id(0), name(""), suit(""), number(0), type(FUNC), evolved(false), targetId(-1) {}
    Card(int i, const std::string& n, const std::string& s, int num, CardType t)
        : id(i), name(n), suit(s), number(num), type(t), evolved(false), targetId(-1) {}
    std::string symbol() const;
    bool isBlack() const;
    bool isRed() const;
};

struct Player {
    int id = 0;
    std::string name;
    std::string identity;     // Au选手 Ag选手 反贼 摸鱼怪
    std::string profession;   // 9种职业
    int hp = 4, max_hp = 4;
    bool alive = true;
    int depression = 0;             // 颓废标记
    std::vector<Card> hand;
    std::vector<Card> equip;
    Card* weapon = nullptr;
    Card* armor = nullptr;
    Card* mount_off = nullptr;
    Card* mount_def = nullptr;
    bool awakened = false;
    int noDamageRounds = 0;
    int damageDealtThisTurn = 0;
    int skipPlayRounds = 0;
    bool retireUsed = false;
    int preventDamageCount = 0;
    bool usedMentor = false;
    int liveViewCount = 0;
    bool usedSealThisGame = false;
    std::vector<int> evoCandidates;
    int evoTotal = 0;
    int evoTurn = 0;
    int acUsedThisTurn = 0;
    int acLimit = 1;
    bool usedUndefeatedThisTurn = false;
    bool usedKangThisTurn = false;
    std::set<std::string> usedSkillsThisTurn;
    bool bossDmgBoost = false;        // 传奇Au觉醒: 本局剩余时间伤害+1
    bool usedAskThisTurn = false;     // 萌新·问问题: 成为卡牌唯一目标时摸1(每回合限一次)
    bool usedSkirtThisTurn = false;   // 女装大佬·女装: 成为锦囊目标时摸1(每回合限一次)
    bool akioiActive = false;         // 神犇·AKIOI: 本回合已激活(伤害+1)
    int yanyaCountThisTurn = 0;       // 神犇·碾压本回合打出AC数量(觉醒计数)
    bool akAllActive = false;         // 神犇觉醒·AK全场: 下一张AC可指定任意数量目标
    int kachangSuccess = 0;           // 毒瘤·卡常成功次数(觉醒计数)
    bool examThisTurn = false;        // 金牌教练·模拟赛是否已在本回合使用
    bool depressionAsked = false;     // 摸鱼怪·颓废: 本回合是否已询问
};

struct Pending {
    std::string type;
    int targetPlayer = -1;
    std::vector<int> validCards;
    json context;
    std::chrono::steady_clock::time_point deadline;
};

class Room {
public:
    int id = 0;
    std::vector<Player> players;
    int currentTurn = 0;
    int roundCount = 1;
    int nextCardId = 10000;
    std::vector<Card> deck, discard;
    std::vector<std::string> log;
    std::string activeEvent = "?";
    bool gameOver = false;
    std::string winner;
    int awakeningCount = 0;            // 觉醒次数(用于本局囧闻)

    enum Phase { ROUND_START, JUDGE, DRAW, PLAY, DISCARD, END, GAME_OVER };
    Phase phase = ROUND_START;
    std::unique_ptr<Pending> pending;
    std::string forcedJudgeColor = ""; // 手动测评: 强制下一次判定花色 red/black
    bool banWANextTurn = false;        // 毒瘤觉醒·全员卡常: 其他角色不能使用WA
    std::string banWABy = "";          // 记录发起全员卡常的玩家名(用于回合结束时解除)

    Player& getPlayer(int pid);
    bool isAlive(int pid) const;
    void addLog(const std::string& msg);
    Card drawCard();
    void shuffleDeck();
    void discardCard(Card& c);
    void discardFromHand(Player& p, int idx);
    int distanceBetween(int from, int to);
    int attackRange(Player& p);
    bool canAttack(int from, int to);
    void equipCard(Player& p, Card& c);
    int dealDamage(Player& source, Player& target, int dmg, bool isAttack, bool isCardEffect = false);
    void checkVictory();
    void clearPending();
    void startResponse(const std::string& type, int target, std::vector<int> valid, json ctx);
    void checkAwakenings();
    void nextPhase();
    void tryEvolutionSelect(Player& p);
    bool useCard(int pid, int cardIdx, std::vector<int> targets, json& result);
    bool useSkill(int pid, const std::string& skill, const json& msg, json& result);
    bool processResponse(int pid, const json& msg, json& result);
    void resetForStart();   // 房间满员时重置对局并开始
    json getStateJson(int viewerId);
};

std::mt19937& rng();
int randInt(int low, int high);
std::string randSuit();
extern std::map<std::string, std::string> evoMap;
